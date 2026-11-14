/* Offscreen Electron recorder for the acceptance demo.
   Loads the harness page, injects real mouse input, captures every painted
   frame with its timestamp, then exits so a script can encode the video. */

const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const WIDTH = 1600
const HEIGHT = 900
const OUT_DIR = path.join(__dirname, '..', 'out', 'frames')
const URL = process.env.DEMO_URL || 'http://127.0.0.1:4610/demo/index.html'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu-compositing')

let win = null
let recording = false
let started = 0
let frameIndex = 0
const stamps = []
const pendingWrites = []

function finish(code) {
  const waitWrites = () => {
    if (pendingWrites.length > 0) return setTimeout(waitWrites, 40)
    const meta = {
      width: WIDTH,
      height: HEIGHT,
      frames: stamps.map((t, i) => ({ file: String(i).padStart(5, '0') + '.jpg', t })),
    }
    try {
      fs.writeFileSync(path.join(__dirname, '..', 'out', 'frames.json'), JSON.stringify(meta))
    } catch (err) {
      console.error('meta write failed', err)
    }
    setTimeout(() => app.exit(code), 120)
  }
  waitWrites()
}

app.whenReady().then(async () => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    webPreferences: {
      offscreen: true,
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: true,
      backgroundThrottling: false,
      webSecurity: false,
    },
  })
  win.webContents.setFrameRate(30)

  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[page]', message)
  })
  win.webContents.on('did-finish-load', async () => {
    try {
      const state = await win.webContents.executeJavaScript(
        "JSON.stringify({ boot: typeof window.__boot, factory: typeof window.__pluginFactory, req: typeof require, err: window.__err || null })",
      )
      console.log('[state]', state)
    } catch (err) {
      console.log('[state error]', err.message)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', JSON.stringify(details))
    app.exit(3)
  })

  win.webContents.on('paint', (_event, _dirty, image) => {
    if (!recording) return
    const t = Date.now() - started
    const name = String(frameIndex).padStart(5, '0') + '.jpg'
    frameIndex++
    stamps.push(t)
    const buf = image.toJPEG(92)
    pendingWrites.push(name)
    fs.writeFile(
      path.join(OUT_DIR, name),
      buf,
      () => {
        const at = pendingWrites.indexOf(name)
        if (at >= 0) pendingWrites.splice(at, 1)
      },
    )
  })

  ipcMain.on('mark', (_event, name) => {
    if (!recording) return
    console.log('[mark] ' + name + ' @ ' + (Date.now() - started) + 'ms')
  })

  ipcMain.on('mouse:move', (_event, x, y) => {
    if (!win || win.isDestroyed()) return
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  })

  ipcMain.handle('mouse:click', async (_event, x, y) => {
    if (!win || win.isDestroyed()) return
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    await new Promise((r) => setTimeout(r, 40))
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    await new Promise((r) => setTimeout(r, 55))
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await new Promise((r) => setTimeout(r, 40))
  })

  ipcMain.handle('rec:start', () => {
    if (recording) return
    recording = true
    started = Date.now()
    console.log('recording started')
  })

  ipcMain.handle('rec:stop', () => {
    if (!recording) return
    recording = false
    console.log('recording stopped: ' + frameIndex + ' frames in ' + (Date.now() - started) + 'ms')
    finish(0)
  })

  await win.loadURL(URL)
  console.log('page loaded')

  // Safety net: never hang the pipeline.
  setTimeout(() => {
    if (recording || frameIndex === 0) {
      console.error('safety timeout, finishing with', frameIndex, 'frames')
      recording = false
      finish(4)
    }
  }, 120000)
})
