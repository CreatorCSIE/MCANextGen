import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath, URL } from 'node:url'
import {
  IPC,
  type HostInfo,
  type MinecraftEmbedBoundsView,
  type MinecraftLaunchOptionsView
} from '@shared/ipc'
import { detectJava } from './java'
import { attachMainWindow, focusGameInput } from './embedding'
import {
  getMinecraftStatusView,
  launchMinecraftView,
  listMinecraftAppletsView,
  listMinecraftVersionsView,
  setMinecraftEmbedBoundsView,
  shutdownMinecraft,
  stopMinecraftView
} from './minecraft'

/** Injected from the package version by electron-vite (see electron.vite.config.ts). */
declare const __HOST_VERSION__: string

app.setName('MCANextGen')

// Phase 3 embedding prerequisite: Chromium composites web contents through a
// DirectComposition visual tree (a child "Intermediate D3D Window"), and DWM
// layers that tree above every ordinary child HWND of the window regardless of
// GDI z-order. A koffi-made clip container (plain GDI child, with the game
// window inside it) then paints invisibly *under* the DOM — measured: geometry,
// parent chain, styles and even z-order were all correct (clip on top of
// Chrome_RenderWidgetHostHWND) yet still hidden by the D3D layer.
// disableHardwareAcceleration() alone does NOT remove the Intermediate D3D
// Window on Chromium 152; --disable-direct-composition forces the compositor to
// render into the window's own surface, so native child windows can overlay it.
// The UI is a simple panel; the cost of software compositing is nil.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-direct-composition')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 640,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    title: 'MCANextGen',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.mjs', import.meta.url)),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }

  // Bind the embedding controller to this window: its `close` hook unembeds
  // the game before the native host HWND (and its child tree) is destroyed.
  attachMainWindow(win)

  return win
}

function registerIpc(): void {
  ipcMain.handle(IPC.HOST_GET_INFO, (): HostInfo => {
    return {
      hostVersion: __HOST_VERSION__,
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome
    }
  })

  ipcMain.handle(IPC.JAVA_DETECT, () => detectJava())
  ipcMain.handle(
    IPC.MINECRAFT_LAUNCH,
    (_event, versionId: string, options?: MinecraftLaunchOptionsView) =>
      launchMinecraftView(versionId, options)
  )
  ipcMain.handle(IPC.MINECRAFT_STOP, () => stopMinecraftView())
  ipcMain.handle(IPC.MINECRAFT_STATUS, () => getMinecraftStatusView())
  ipcMain.handle(IPC.MINECRAFT_LIST_VERSIONS, () => listMinecraftVersionsView())
  ipcMain.handle(IPC.MINECRAFT_LIST_APPLETS, (_event, versionId: string) =>
    listMinecraftAppletsView(versionId)
  )
  ipcMain.handle(
    IPC.MINECRAFT_SET_EMBED_BOUNDS,
    (_event, bounds: MinecraftEmbedBoundsView) => setMinecraftEmbedBoundsView(bounds)
  )
  ipcMain.handle(IPC.MINECRAFT_FOCUS_GAME, () => focusGameInput())
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Phase 1: the game is a separate top-level process; never orphan it when the host exits.
app.on('before-quit', () => shutdownMinecraft())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
