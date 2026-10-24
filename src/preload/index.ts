import { contextBridge, ipcRenderer } from 'electron'
import type { HubApi, UpdateState } from '../shared/api'

const api: HubApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  appInfo: () => ipcRenderer.invoke('app:info'),
  loadNews: () => ipcRenderer.invoke('news:load'),
  sourceStatuses: () => ipcRenderer.invoke('news:source-statuses'),
  testSource: (source) => ipcRenderer.invoke('news:test-source', source),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  moveToApplications: () => ipcRenderer.invoke('app:move-to-applications'),
  rates: (base, symbols) => ipcRenderer.invoke('widgets:rates', base, symbols),
  weather: (place) => ipcRenderer.invoke('widgets:weather', place),
  findPlaces: (query) => ipcRenderer.invoke('widgets:places', query),
  accounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (provider, input) => ipcRenderer.invoke('accounts:add', provider, input),
  updateAccount: (id, patch) => ipcRenderer.invoke('accounts:update', id, patch),
  reconnectAccount: (id) => ipcRenderer.invoke('accounts:reconnect', id),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  recentMail: () => ipcRenderer.invoke('accounts:mail'),
  upcomingEvents: () => ipcRenderer.invoke('accounts:events'),
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
