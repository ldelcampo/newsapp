import { contextBridge, ipcRenderer } from 'electron'
import type { HubApi } from '../shared/api'

const api: HubApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  appInfo: () => ipcRenderer.invoke('app:info'),
  loadNews: () => ipcRenderer.invoke('news:load'),
  testSource: (source) => ipcRenderer.invoke('news:test-source', source),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url)
}

contextBridge.exposeInMainWorld('hub', api)
