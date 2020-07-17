import { errors } from '../util.js'

const { INVALID, GONE, MISMATCH, MOD_ERR, SYNTAX } = errors

const DIR = { headers: { 'content-type': 'dir' } }
const FILE = () => ({ headers: { 'content-type': 'file', 'last-modified': Date.now() } })

class Sink {
  constructor (cache, path, file) {
    this.cache = cache
    this.path = path
    this.size = file.size
    this.position = 0
    this.file = file
  }
  write (chunk, c) {
    if (typeof chunk === 'object') {
      if (chunk.type === 'write') {
        if (Number.isInteger(chunk.position) && chunk.position >= 0) {
          if (this.size < chunk.position) {
            throw new DOMException(...INVALID)
          }
          this.position = chunk.position
        }
        if (!('data' in chunk)) {
          throw new DOMException(...SYNTAX('write requires a data argument'))
        }
        chunk = chunk.data
      } else if (chunk.type === 'seek') {
        if (Number.isInteger(chunk.position) && chunk.position >= 0) {
          if (this.size < chunk.position) {
            throw new DOMException(...INVALID)
          }
          this.position = chunk.position
          return
        } else {
          throw new DOMException(...SYNTAX('seek requires a position argument'))
        }
      } else if (chunk.type === 'truncate') {
        if (Number.isInteger(chunk.size) && chunk.size >= 0) {
          let file = this.file
          file = chunk.size < this.size
            ? file.slice(0, chunk.size)
            : new File([file, new Uint8Array(chunk.size - this.size)], file.name)

          this.size = file.size
          if (this.position > file.size) {
            this.position = file.size
          }
          this.file = file
          return
        } else {
          throw new DOMException(...SYNTAX('truncate requires a size argument'))
        }
      }
    }

    chunk = new Blob([chunk])

    let blob = this.file
    // Calc the head and tail fragments
    const head = blob.slice(0, this.position)
    const tail = blob.slice(this.position + chunk.size)

    // Calc the padding
    let padding = this.position - head.size
    if (padding < 0) {
      padding = 0
    }
    blob = new File([
      head,
      new Uint8Array(padding),
      chunk,
      tail
    ], blob.name)
    this.size = blob.size
    this.position += chunk.size
    this.file = blob
  }
  async close () {
    const [r] = await this.cache.keys(this.path)
    if (!r) throw new DOMException(...GONE)
    return this.cache.put(this.path, new Response(this.file, FILE()))
  }
}

export class FileHandle {
  constructor (path, cache) {
    this.cache = cache
    this.path = path
    this.kind = 'file'
    this.writable = true
    this.readable = true
  }
  get name () {
    return this.path.split('/').pop()
  }
  async getFile () {
    const res = await this.cache.match(this.path)
    if (!res) throw new DOMException(...GONE)
    const blob = await res.blob()
    const file = new File([blob], this.name, { lastModified: +res.headers.get('last-modified') })
    return file
  }
  async createWritable (opts) {
    return new Sink(this.cache, this.path, await this.getFile())
    // let p, rs
    // p = new Promise(resolve => rs = resolve)
    // const { readable, writable } = new TransformStream(new Sink(p))
    // this.cache.put(this.path, new Response(readable, FILE())).then(rs)
    // return writable.getWriter()
  }
}

export class FolderHandle {
  constructor (dir, cache) {
    this.dir = dir
    this.writable = true
    this.readable = true
    this.cache = cache
    this.kind = 'directory'
    this.name = dir.split('/').pop()
  }
  async * getEntries () {
    for (let [path, isFile] of Object.entries(await this._tree)) {
      yield isFile ? new FileHandle(path, this.cache) : new FolderHandle(path, this.cache)
    }
  }
  async getDirectoryHandle (name, opts = {}) {
    const path = this.dir.endsWith('/') ? this.dir + name : `${this.dir}/${name}`
    const tree = await this._tree
    if (tree.hasOwnProperty(path)) {
      const isFile = tree[path]
      if (isFile) throw new DOMException(...MISMATCH)
      return new FolderHandle(path, this.cache)
    } else {
      if (opts.create) {
        tree[path] = false
        await this.cache.put(path, new Response('{}', DIR))
        await this._save(tree)
        return new FolderHandle(path, this.cache)
      }
      throw new DOMException(...GONE)
    }
    // return new Promise((rs, rj) => {
    //   this.dir.getDirectory(name, opts, dir => {
    //     rs(new FolderHandle(dir))
    //   }, rj)
    // })
  }
  get _tree() {
    return this.cache.match(this.dir).then(r=>r.json()).catch(e => {
      throw new DOMException(...GONE)
    })
  }
  _save (tree) {
    return this.cache.put(this.dir, new Response(JSON.stringify(tree), DIR))
  }
  async getFileHandle (name, opts = {}) {
    const path = this.dir.endsWith('/') ? this.dir + name : `${this.dir}/${name}`
    const tree = await this._tree
    if (tree.hasOwnProperty(path)) {
      const isFile = tree[path]
      if (!isFile) throw new DOMException(...MISMATCH)
      return new FileHandle(path, this.cache)
    } else {
      if (opts.create) {
        const tree = await this._tree
        tree[path] = true
        await this.cache.put(path, new Response('', FILE()))
        await this._save(tree)
        return new FileHandle(path, this.cache)
      } else {
        throw new DOMException(...GONE)
      }
    }
  }
  async removeEntry (name, opts) {
    const tree = await this._tree
    const path = this.dir.endsWith('/') ? this.dir + name : `${this.dir}/${name}`
    if (tree.hasOwnProperty(path)) {
      if (opts.recursive) {
        const toDelete = [...Object.entries(tree)]
        while (toDelete.length) {
          const [path, isFile] = toDelete.pop()
          if (isFile) {
            await this.cache.delete(path)
          } else {
            const e = await this.cache.match(path).then(r => r.json())
            toDelete.push(...Object.entries(e))
          }
        }
        delete tree[path]
      } else {
        const isFile = tree[path]
        delete tree[path]
        if (isFile) {
          await this.cache.delete(path)
        } else {
          const e = await this.cache.match(path).then(r => r.json())
          const keys = Object.keys(e)
          if (keys.length) {
            throw new DOMException(...MOD_ERR)
          } else {
            await this.cache.delete(path)
          }
        }
      }

      await this._save(tree)
    } else {
      throw new DOMException(...GONE)
    }
  }
}

export default async function (opts = {}) {
  await caches.delete('sandboxed-fs')
  const cache = await caches.open('sandboxed-fs')
  if (!await cache.match('/')) await cache.put('/', new Response('{}', DIR))
  return new FolderHandle(location.origin + '/', cache)
}
