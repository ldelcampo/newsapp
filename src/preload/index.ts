import { contextBridge, ipcRenderer } from 'electron'
import type { HubApi, UpdateState } from '../shared/api'
import type { FactCheckStep } from '../shared/factcheck'
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
  jiraConnect: (input) => ipcRenderer.invoke('jira:connect', input),
  jiraDisconnect: (siteId) => ipcRenderer.invoke('jira:disconnect', siteId),
  tickets: (force) => ipcRenderer.invoke('jira:tickets', force),
  hasJevKey: () => ipcRenderer.invoke('jev:has-key'),
  setJevKey: (key) => ipcRenderer.invoke('jev:set-key', key),
  accounts: () => ipcRenderer.invoke('accounts:list'),
  accountProviders: () => ipcRenderer.invoke('accounts:providers'),
  addAccount: (provider, input) => ipcRenderer.invoke('accounts:add', provider, input),
  updateAccount: (id, patch) => ipcRenderer.invoke('accounts:update', id, patch),
  reconnectAccount: (id) => ipcRenderer.invoke('accounts:reconnect', id),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  testImap: (input) => ipcRenderer.invoke('accounts:test-imap', input),
  recentMail: (force) => ipcRenderer.invoke('accounts:mail', force),
  mailBody: (accountId, id) => ipcRenderer.invoke('mail:body', accountId, id),
  mailFeedback: (id, verdict) => ipcRenderer.invoke('mail:feedback', id, verdict),
  mailLearned: () => ipcRenderer.invoke('mail:learned'),
  resetMailFeedback: () => ipcRenderer.invoke('mail:reset-feedback'),
  upcomingEvents: () => ipcRenderer.invoke('accounts:events'),
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
