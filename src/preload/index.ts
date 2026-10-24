import { contextBridge, ipcRenderer } from 'electron'
import type { HubApi, UpdateState } from '../shared/api'
import type { Settings } from '../shared/settings'

const api: HubApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  appInfo: () => ipcRenderer.invoke('app:info'),
  loadNews: () => ipcRenderer.invoke('news:load'),
  sourceStatuses: () => ipcRenderer.invoke('news:source-statuses'),
  testSource: (source) => ipcRenderer.invoke('news:test-source', source),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  syncSignIn: (server, email, passphrase, create) => ipcRenderer.invoke('sync:sign-in', server, email, passphrase, create),
  syncSignOut: () => ipcRenderer.invoke('sync:sign-out'),
  chooseSyncFolder: () => ipcRenderer.invoke('sync:choose-folder'),
  iCloudFolder: () => ipcRenderer.invoke('sync:icloud-folder'),
  onSettingsChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: Settings): void => cb(s)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  moveToApplications: () => ipcRenderer.invoke('app:move-to-applications'),
  rates: (base, symbols) => ipcRenderer.invoke('widgets:rates', base, symbols),
  weather: (place) => ipcRenderer.invoke('widgets:weather', place),
  findPlaces: (query) => ipcRenderer.invoke('widgets:places', query),
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
