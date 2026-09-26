import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HostApi } from '@shared/ipc'

const api: HostApi = {
  getInfo: () => ipcRenderer.invoke(IPC.HOST_GET_INFO),
  detectJava: () => ipcRenderer.invoke(IPC.JAVA_DETECT),
  launchMinecraft: (versionId: string) =>
    ipcRenderer.invoke(IPC.MINECRAFT_LAUNCH, versionId),
  stopMinecraft: () => ipcRenderer.invoke(IPC.MINECRAFT_STOP),
  getMinecraftStatus: () => ipcRenderer.invoke(IPC.MINECRAFT_STATUS)
}

contextBridge.exposeInMainWorld('mcanextgen', api)
