import { contextBridge, ipcRenderer } from 'electron'
import type { HubApi, UpdateState } from '../shared/api'
import type { FactCheckStep } from '../shared/factcheck'

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
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, state: UpdateState): void => cb(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  verifyArticle: (articleId) => ipcRenderer.invoke('factcheck:run', articleId),
  savedReport: (articleId) => ipcRenderer.invoke('factcheck:saved', articleId),
  onVerifyStep: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, articleId: string, step: FactCheckStep): void => cb(articleId, step)
    ipcRenderer.on('factcheck:step', listener)
    return () => ipcRenderer.removeListener('factcheck:step', listener)
  },
  secrets: () => ipcRenderer.invoke('secrets:list'),
  setSecret: (name, value) => ipcRenderer.invoke('secrets:set', name, value),
  testProvider: (provider) => ipcRenderer.invoke('factcheck:test', provider)
}

contextBridge.exposeInMainWorld('hub', api)
