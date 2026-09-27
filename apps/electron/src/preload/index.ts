import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HostApi } from '@shared/ipc'

const api: HostApi = {
  getInfo: () => ipcRenderer.invoke(IPC.HOST_GET_INFO),
  detectJava: () => ipcRenderer.invoke(IPC.JAVA_DETECT),
  launchMinecraft: (versionId, options) =>
    ipcRenderer.invoke(IPC.MINECRAFT_LAUNCH, versionId, options),
  stopMinecraft: () => ipcRenderer.invoke(IPC.MINECRAFT_STOP),
  getMinecraftStatus: () => ipcRenderer.invoke(IPC.MINECRAFT_STATUS),
  listMinecraftVersions: () => ipcRenderer.invoke(IPC.MINECRAFT_LIST_VERSIONS)
}

contextBridge.exposeInMainWorld('mcanextgen', api)
