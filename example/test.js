import * as fs from '../src/es6.js'
import {
  getDirectoryEntryCount,
  assert,
  capture
} from '../test/util.js'

const {
  showDirectoryPicker,
  showOpenFilePicker,
  showSaveFilePicker,
  getOriginPrivateDirectory
} = fs

globalThis.fs = fs

if (!Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Response(this).text()
  }
  Blob.prototype.arrayBuffer = function () {
    return new Response(this).arrayBuffer()
  }
  Blob.prototype.stream = function () {
    return new Response(this).body
  }
}

globalThis.showOpenFilePicker = showOpenFilePicker;
globalThis.showSaveFilePicker = showSaveFilePicker;
globalThis.getOriginPrivateDirectory = getOriginPrivateDirectory;
globalThis.showDirectoryPicker = showDirectoryPicker;

let err

// get some dummy gradient image
function img (format) {
  const a = document.createElement('canvas')
  const b = a.getContext('2d')
  const c = b.createLinearGradient(0, 0, 1500, 1500)
  a.width = a.height = 3000
  c.addColorStop(0, 'red')
  c.addColorStop(1, 'blue')
  b.fillStyle = c
  b.fillRect(0, 0, a.width, a.height)
  return new Promise(resolve => {
    a.toBlob(resolve, 'image/' + format, 1)
  })
}


form_showDirectoryPicker.onsubmit = evt => {
  evt.preventDefault()
  /** @type {Object<string, *>} */
  const opts = Object.fromEntries([...new FormData(evt.target)])
  opts._preferPolyfill = !!opts._preferPolyfill
  showDirectoryPicker(opts).then(showFileStructure, console.error)
}
form_showOpenFilePicker.onsubmit = evt => {
  evt.preventDefault()
  /** @type {Object<string, *>} */
  const opts = Object.fromEntries([...new FormData(evt.target)])
  opts.types = JSON.parse(opts.types || '""')
  opts._preferPolyfill = !!opts._preferPolyfill
  showOpenFilePicker(opts).then(handles => {
    console.log(handles)
    alert(handles)
  }, err => {
    console.error(err)
    alert(err)
  })
}
form_showSaveFilePicker.onsubmit = async evt => {
  evt.preventDefault()
  /** @type {Object<string, *>} */
  const opts = Object.fromEntries([...new FormData(evt.target)])
  opts.types = JSON.parse(opts.types || '""')
  opts._preferPolyfill = !!opts._preferPolyfill
  const handle = await showSaveFilePicker(opts)
  const format = handle.name.split('.').pop()
  const image = await img(format)
  const ws = await handle.createWritable()
  await ws.write(image)
  await ws.close()
}


globalThis.ondragover = evt => evt.preventDefault()
globalThis.ondrop = async evt => {
  evt.preventDefault()

  for (const item of evt.dataTransfer.items) {
    item.getAsFileSystemHandle().then(async handle => {
      if (handle.kind === 'directory') {
        showFileStructure(handle)
      } else {
        const file = await handle.getFile()
        console.log(file)
        alert(file)
      }
    })
  }
}

/** @param {fs.FileSystemDirectoryHandle} root */
async function showFileStructure (root) {
  const result = []
  let cwd = ''

  /** @type {HTMLInputElement} */
  const input = document.querySelector('[form=form_showOpenFilePicker][name="_preferPolyfill"]')
  const readonly = input.checked

  try {
    readonly && assert(await getDirectoryEntryCount(root) > 0)
    readonly && assert(await root.requestPermission({ writable: true }) === 'denied')
    const dirs = [root]

    for (const dir of dirs) {
      cwd += dir.name + '/'
      for await (const [name, handle] of dir) {
        // Everything should be read only
        readonly && assert(await handle.requestPermission({ writable: true }) === 'denied')
        readonly && assert(await handle.requestPermission({ readable: true }) === 'granted')
        if (handle.kind === 'file') {
          result.push(cwd + handle.name)
          readonly && (err = await capture(handle.createWritable()))
          readonly && assert(err.name === 'NotAllowedError')
        } else {
          result.push(cwd + handle.name + '/')
          assert(handle.kind === 'directory')
          dirs.push(handle)
        }
      }
    }
    const json = JSON.stringify(result.sort(), null, 2)
    console.log(json)
    alert('assertion succeed\n' + json)
  } catch (err) {
    console.log(err)
    alert('assertion failed - see console')
  }
}
