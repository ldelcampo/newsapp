import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { makeProvider } from './ai-providers'
import { FactCheckService } from './fact-check-service'
import { SecretStore } from './secret-store'
import { PROVIDERS, SECRET_NAMES, SYSTEM_PROMPT, type ProviderId, type SecretName } from '../shared/factcheck'
import { NewsService, testSource } from './news-service'
import { SettingsStore } from './settings-store'
import { startUpdater } from './updater'
import { normalizeSettings } from '../shared/settings'
import { normalizeWidget } from '../shared/widgets'
import { WidgetService } from './widget-service'

let store: SettingsStore
let news: NewsService
let secrets: SecretStore
let factCheck: FactCheckService
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
  secrets = new SecretStore(app.getPath('userData'), safeStorage)
  factCheck = new FactCheckService(app.getPath('userData'))
  nativeTheme.themeSource = store.load().theme

  const providerFor = (id: ProviderId): ReturnType<typeof makeProvider> => {
    const fc = store.load().factCheck
    return makeProvider(id, fc.models[id], id === 'ollama' ? null : secrets.get(id), fc.ollamaUrl)
  }
  // One check per story at a time, so a double click doesn't pay twice.
  const running = new Map<string, Promise<unknown>>()
  ipcMain.handle('factcheck:run', async (e, articleId: unknown) => {
    if (typeof articleId !== 'string') throw new Error('No story given.')
    const pending = running.get(articleId)
    if (pending) return pending
    if (news.lastArticles.length === 0) await news.load(store.load())
    const article = news.lastArticles.find((a) => a.id === articleId)
    if (!article) throw new Error('That story is no longer loaded. Refresh the news and try again.')
    const settings = store.load().factCheck
    const job = factCheck
      .run({
        article,
        pool: news.lastArticles,
        settings,
        provider: providerFor(settings.provider),
        googleKey: secrets.get('googleFactCheck'),
        onStep: (step) => {
          if (!e.sender.isDestroyed()) e.sender.send('factcheck:step', articleId, step)
        }
      })
      .finally(() => running.delete(articleId))
    running.set(articleId, job)
    return job
  })
  ipcMain.handle('factcheck:saved', (_e, articleId: unknown) => (typeof articleId === 'string' ? factCheck.saved(articleId) : null))
  ipcMain.handle('factcheck:test', async (_e, id: unknown) => {
    if (!PROVIDERS.some((p) => p.id === id)) return { ok: false, error: 'Unknown provider.' }
    const provider = providerFor(id as ProviderId)
    if (!provider) return { ok: false, error: 'Save a key for this provider first.' }
    try {
      await provider.ask({ system: SYSTEM_PROMPT, prompt: 'Reply with {"ok":true}' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('secrets:list', () => secrets.which())
  ipcMain.handle('secrets:set', (_e, name: unknown, value: unknown) => {
    if (!SECRET_NAMES.includes(name as SecretName) || typeof value !== 'string' || value.length > 500) throw new Error('That key could not be saved.')
    secrets.set(name as SecretName, value)
    return secrets.which()
  })

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
