import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { NewsService, testSource } from './news-service'
import { SettingsStore } from './settings-store'
import { startUpdater } from './updater'
import { normalizeSettings } from '../shared/settings'
import { cleanSiteUrl, siteKind, type JiraSite } from '../shared/jira'
import { newWidget, normalizeWidget } from '../shared/widgets'
import { JEV_SECRET, JiraService, jiraSecret } from './jira-service'
import { SecretStore } from './secrets'
import { WidgetService } from './widget-service'

let store: SettingsStore
let news: NewsService
let secrets: SecretStore
let jira: JiraService
const widgets = new WidgetService()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Information Hub',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  store = new SettingsStore(app.getPath('userData'))
  news = new NewsService(app.getPath('userData'))
  nativeTheme.themeSource = store.load().theme
  // Only for automated tests on Linux machines without a keyring.
  if (process.env.HUB_E2E_PLAINTEXT_SECRETS === '1' && process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
  secrets = new SecretStore(app.getPath('userData'), {
    encrypt: (v) => safeStorage.encryptString(v),
    decrypt: (b) => safeStorage.decryptString(b)
  })
  jira = new JiraService(app.getPath('userData'), secrets)

  ipcMain.handle('settings:get', () => store.load())
  ipcMain.handle('settings:save', (_e, next: unknown) => {
    const saved = store.save(next)
    nativeTheme.themeSource = saved.theme
    return saved
  })
  ipcMain.handle('news:load', () => news.load(store.load()))
  ipcMain.handle('news:source-statuses', async () => (news.lastSources.length ? news.lastSources : (await news.load(store.load())).sources))
  ipcMain.handle('news:test-source', (_e, source: unknown) => {
    // Reuse settings validation so the renderer cannot hand us a malformed source.
    const [clean] = normalizeSettings({ customSources: [source] }).customSources
    return clean ? testSource(clean) : { ok: false, error: 'Enter a name and an address starting with https://.' }
  })
  ipcMain.handle('app:move-to-applications', () => process.platform === 'darwin' && app.isPackaged && app.moveToApplicationsFolder())
  ipcMain.handle('app:open-external', (_e, url: unknown) => {
    if (typeof url === 'string' && url.startsWith('https://')) return shell.openExternal(url)
  })
  // Inputs go through widget validation, so only known currencies and real coordinates reach the services.
  ipcMain.handle('widgets:rates', (_e, base: unknown, symbols: unknown) => {
    const w = normalizeWidget({ id: 'x', type: 'currency', base, symbols })
    return w?.type === 'currency' ? widgets.rates(w.base, w.symbols) : null
  })
  ipcMain.handle('widgets:weather', (_e, place: unknown) => {
    const w = normalizeWidget({ id: 'x', type: 'weather', place })
    return w?.type === 'weather' ? widgets.weather(w.place) : null
  })
  ipcMain.handle('widgets:places', (_e, query: unknown) => (typeof query === 'string' ? widgets.places(query.slice(0, 80)) : []))
  ipcMain.handle('jira:connect', async (_e, input: unknown) => {
    const r = (input ?? {}) as Record<string, unknown>
    const url = cleanSiteUrl(String(r.url ?? ''))
    const email = String(r.email ?? '').trim()
    const token = String(r.token ?? '').trim()
    if (!url) return { ok: false, error: 'Enter your Jira address, like https://yourteam.atlassian.net.' }
    const kind = siteKind(url)
    if (kind === 'cloud' && !/^[^@\s]+@[^@\s]+$/.test(email)) return { ok: false, error: 'Enter the email you sign in to Jira with.' }
    if (token.length < 10) return { ok: false, error: kind === 'cloud' ? 'Paste an API token.' : 'Paste a personal access token.' }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'This computer has no keychain to keep the token safe, so Jira can’t be connected.' }
    try {
      const name = await jira.whoAmI({ url, kind, email }, token).catch((e: Error) => {
        throw /refused the token/.test(e.message) ? new Error(`Jira didn’t accept that ${kind === 'cloud' ? 'email and token. Check them' : 'token. Check it'} and try again.`) : e
      })
      const current = store.load()
      const existing = current.jiraSites.find((x) => x.url === url && x.email === email)
      const site: JiraSite = { id: existing?.id ?? `jira-${Date.now().toString(36)}`, url, kind, email, name }
      secrets.set(jiraSecret(site.id), token)
      jira.forget(site.id)
      // The first connection puts "Needs you today" on the dashboard if it isn't there.
      const dashboard = current.dashboard.some((w) => w.type === 'tickets') ? current.dashboard : [newWidget('tickets', 'tickets'), ...current.dashboard]
      const settings = store.save({ ...current, dashboard, jiraSites: [...current.jiraSites.filter((x) => x.id !== site.id), site] })
      return { ok: true, settings }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('jira:disconnect', (_e, id: unknown) => {
    const current = store.load()
    secrets.set(jiraSecret(String(id)), null)
    jira.forget(String(id))
    return store.save({ ...current, jiraSites: current.jiraSites.filter((x) => x.id !== id) })
  })
  ipcMain.handle('jira:tickets', (_e, force: unknown) => jira.load(store.load(), force === true))
  ipcMain.handle('jev:has-key', () => secrets.has(JEV_SECRET))
  ipcMain.handle('jev:set-key', (_e, key: unknown) => {
    const k = typeof key === 'string' ? key.trim() : ''
    secrets.set(JEV_SECRET, k.length >= 10 ? k : null)
    return secrets.has(JEV_SECRET)
  })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: app.getPath('userData')
  }))

  createWindow()
  startUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
