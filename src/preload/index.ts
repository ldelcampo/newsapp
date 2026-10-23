import { contextBridge, ipcRenderer } from 'electron'
import type { HubApi } from '../shared/api'

const api: HubApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  appInfo: () => ipcRenderer.invoke('app:info')
}

contextBridge.exposeInMainWorld('hub', api)
