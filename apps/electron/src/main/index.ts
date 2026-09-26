import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath, URL } from 'node:url'
import { IPC, type HostInfo } from '@shared/ipc'
import { detectJava } from './java'
import {
  launchMinecraftView,
  minecraftStatusView,
  shutdownMinecraft,
  stopMinecraftView
} from './minecraft'

/** Injected from the package version by electron-vite (see electron.vite.config.ts). */
declare const __HOST_VERSION__: string

app.setName('MCANextGen')

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
  ipcMain.handle(IPC.MINECRAFT_LAUNCH, (_event, versionId: string) =>
    launchMinecraftView(versionId)
  )
  ipcMain.handle(IPC.MINECRAFT_STOP, () => stopMinecraftView())
  ipcMain.handle(IPC.MINECRAFT_STATUS, () => minecraftStatusView())
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
