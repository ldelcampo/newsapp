import { contextBridge, ipcRenderer } from 'electron'
import type { HubApi, UpdateState } from '../shared/api'

const api: HubApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  appInfo: () => ipcRenderer.invoke('app:info'),
  loadNews: () => ipcRenderer.invoke('news:load'),
  testSource: (source) => ipcRenderer.invoke('news:test-source', source),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, state: UpdateState): void => cb(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  }
}

contextBridge.exposeInMainWorld('hub', api)
