import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HostApi } from '@shared/ipc'

const api: HostApi = {
  getInfo: () => ipcRenderer.invoke(IPC.HOST_GET_INFO),
  detectJava: () => ipcRenderer.invoke(IPC.JAVA_DETECT)
}

contextBridge.exposeInMainWorld('mcanextgen', api)
