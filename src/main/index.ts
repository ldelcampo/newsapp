import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { makeProvider } from './ai-providers'
import { FactCheckService } from './fact-check-service'
import { SecretStore } from './secret-store'
import { PROVIDERS as AI_PROVIDERS, SECRET_NAMES, SYSTEM_PROMPT, type ProviderId, type SecretName } from '../shared/factcheck'
import { MAIL_ACTIONS, normalizeDraft, PROVIDERS, type MailAction, type Provider } from '../shared/accounts'
import { SNOOZE_OPTIONS, type SnoozeOption } from '../shared/mail'
import { GoogleConnector } from './accounts/google'
import { googleClient } from './accounts/google-client'
import { ImapConnector, testImap } from './accounts/imap'
import { MICROSOFT_CLIENT_ID, MicrosoftConnector, MsalTokens } from './accounts/microsoft'
import { AccountService } from './accounts/service'
import { MailService, taskDescription } from './mail-service'
import { AccountStore, type Cipher } from './accounts/store'
import { NewsService, testSource } from './news-service'
import { SettingsStore } from './settings-store'
import { AccountVault } from './account'
import { FolderRemote, ServerRemote, SettingsSync } from './settings-sync'
import { startUpdater } from './updater'
import { normalizeSettings } from '../shared/settings'
import { cleanSiteUrl, siteKind, type JiraSite } from '../shared/jira'
import { newWidget, normalizeWidget } from '../shared/widgets'
import { JEV_SECRET, JiraError, JiraService, jiraSecret } from './jira-service'
import { SecretStore as TokenStore } from './secrets'
import { WidgetService } from './widget-service'

let store: SettingsStore
let news: NewsService
let secrets: SecretStore
let tokens: TokenStore
let jira: JiraService
let factCheck: FactCheckService
let sync: SettingsSync
let accounts: AccountService
let mail: MailService
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
  // Only for automated tests on Linux machines without a keyring.
  if (process.env.HUB_E2E_PLAINTEXT_SECRETS === '1' && process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
  tokens = new TokenStore(app.getPath('userData'), {
    encrypt: (v) => safeStorage.encryptString(v),
    decrypt: (b) => safeStorage.decryptString(b)
  })
  jira = new JiraService(app.getPath('userData'), tokens)
  sync = new SettingsSync(store, app.getPath('userData'), (s) => {
    nativeTheme.themeSource = s.theme
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', s)
  })
  const vault = new AccountVault(app.getPath('userData'), {
    encrypt: (t) => safeStorage.encryptString(t),
    decrypt: (b) => safeStorage.decryptString(b)
  })
  // The account wins over a folder when both are set.
  const connect = (): Promise<void> => {
    const account = vault.load()
    if (account) {
      const remote = new ServerRemote(account, undefined, () => {
        vault.forget()
        void connect()
      })
      return sync.use(remote, { mode: 'account', folder: '', email: account.email, server: account.server })
    }
    const folder = store.load().syncFolder
    if (folder) return sync.use(new FolderRemote(folder, () => void sync.sync()), { mode: 'folder', folder })
    return sync.use(null, { mode: 'off', folder: '' })
  }
  void connect()

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
    if (!AI_PROVIDERS.some((p) => p.id === id)) return { ok: false, error: 'Unknown provider.' }
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
  // Sign-ins are encrypted with the OS keychain; without one, nothing secret is written.
  const cipher: Cipher = {
    encrypt: (plain) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no keychain to keep sign-ins safe.')
      return safeStorage.encryptString(plain)
    },
    decrypt: (data) => safeStorage.decryptString(data)
  }
  const accountStore = new AccountStore(app.getPath('userData'), cipher)
  accounts = new AccountService(accountStore, {
    // Microsoft sign-in waits for an Entra app registration (see README).
    ...(MICROSOFT_CLIENT_ID ? { microsoft: new MicrosoftConnector(new MsalTokens(accountStore, (url) => shell.openExternal(url))) } : {}),
    google: new GoogleConnector({ store: accountStore, client: googleClient, openBrowser: (url) => void shell.openExternal(url) }),
    imap: new ImapConnector(accountStore)
  })
  mail = new MailService(app.getPath('userData'), accounts, tokens, undefined, undefined, () => providerFor(store.load().factCheck.provider))

  ipcMain.handle('settings:get', () => store.load())
  ipcMain.handle('settings:save', async (_e, next: unknown) => {
    const folderBefore = store.load().syncFolder
    const saved = sync.save(next)
    if (saved.syncFolder !== folderBefore) await connect()
    nativeTheme.themeSource = saved.theme
    return saved
  })
  ipcMain.handle('sync:status', () => sync.getStatus())
  ipcMain.handle('sync:now', async () => {
    await sync.sync()
    return sync.getStatus()
  })
  ipcMain.handle('sync:sign-in', async (_e, server: unknown, email: unknown, passphrase: unknown, create: unknown) => {
    if (typeof server !== 'string' || typeof email !== 'string' || typeof passphrase !== 'string') throw new Error('Fill in every field.')
    await vault.signIn(server, email, passphrase, create === true)
    await connect()
    return sync.getStatus()
  })
  ipcMain.handle('sync:sign-out', async () => {
    await vault.signOut()
    await connect()
    return sync.getStatus()
  })
  ipcMain.handle('sync:choose-folder', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose a folder your computers share', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  // iCloud Drive's folder on macOS, if it is turned on.
  ipcMain.handle('sync:icloud-folder', () => {
    const p = join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
    return process.platform === 'darwin' && existsSync(p) ? p : null
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
      const { name, apiUrl } = await jira.whoAmI({ url, kind, email }, token).catch((e: Error) => {
        throw e instanceof JiraError && e.status === 401
          ? new Error(
              kind === 'cloud'
                ? 'Jira didn’t accept that email and token. Use the email you sign in to Atlassian with, and a token from id.atlassian.com made by that same account.'
                : 'Jira didn’t accept that token. Check it and try again.'
            )
          : e
      })
      const current = store.load()
      const existing = current.jiraSites.find((x) => x.url === url && x.email === email)
      const site: JiraSite = { id: existing?.id ?? `jira-${Date.now().toString(36)}`, url, kind, email, name, ...(apiUrl ? { apiUrl } : {}) }
      tokens.set(jiraSecret(site.id), token)
      jira.forget(site.id)
      // The first connection puts "Needs you today" on the dashboard if it isn't there.
      const dashboard = current.dashboard.some((w) => w.type === 'tickets') ? current.dashboard : [newWidget('tickets', 'tickets'), ...current.dashboard]
      const settings = sync.save({ ...current, dashboard, jiraSites: [...current.jiraSites.filter((x) => x.id !== site.id), site] })
      return { ok: true, settings }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('jira:disconnect', (_e, id: unknown) => {
    const current = store.load()
    tokens.set(jiraSecret(String(id)), null)
    jira.forget(String(id))
    return sync.save({ ...current, jiraSites: current.jiraSites.filter((x) => x.id !== id) })
  })
  ipcMain.handle('jira:tickets', (_e, force: unknown) => jira.load(store.load(), force === true))
  ipcMain.handle('jev:has-key', () => tokens.has(JEV_SECRET))
  ipcMain.handle('jev:set-key', (_e, key: unknown) => {
    const k = typeof key === 'string' ? key.trim() : ''
    tokens.set(JEV_SECRET, k.length >= 10 ? k : null)
    return tokens.has(JEV_SECRET)
  })
  const provider = (p: unknown): Provider => {
    const found = PROVIDERS.find((x) => x.provider === p)
    if (!found) throw new Error('Unknown account type')
    return found.provider
  }
  const id = (v: unknown): string => {
    if (typeof v !== 'string' || !v) throw new Error('Unknown account')
    return v
  }
  ipcMain.handle('accounts:list', () => accounts.list())
  ipcMain.handle('accounts:providers', () => accounts.providers())
  ipcMain.handle('accounts:add', (_e, p: unknown, input: unknown) => accounts.add(provider(p), input))
  ipcMain.handle('accounts:update', (_e, a: unknown, patch: unknown) => {
    const r = (patch ?? {}) as Record<string, unknown>
    return accounts.update(id(a), {
      ...(typeof r.mail === 'boolean' ? { mail: r.mail } : {}),
      ...(typeof r.calendar === 'boolean' ? { calendar: r.calendar } : {})
    })
  })
  ipcMain.handle('accounts:reconnect', (_e, a: unknown) => accounts.reconnect(id(a)))
  ipcMain.handle('accounts:remove', (_e, a: unknown) => accounts.remove(id(a)))
  ipcMain.handle('accounts:test-imap', async (_e, input: unknown) => {
    const { caldavUrl: _found, ...result } = await testImap(input)
    return result
  })
  ipcMain.handle('accounts:mail', (_e, force: unknown) => mail.load(store.load(), force === true))
  ipcMain.handle('mail:body', (_e, a: unknown, m: unknown) => accounts.message(id(a), id(m)))
  ipcMain.handle('mail:feedback', (_e, m: unknown, verdict: unknown) => mail.feedback(id(m), verdict === 'important' || verdict === 'not' ? verdict : null))
  ipcMain.handle('mail:act', (_e, ids: unknown, action: unknown) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !MAIL_ACTIONS.includes(action as MailAction)) throw new Error('Nothing to do.')
    return mail.act(ids.map(id), action as MailAction)
  })
  ipcMain.handle('mail:snooze', (_e, m: unknown, option: unknown) =>
    mail.snooze(id(m), SNOOZE_OPTIONS.some((o) => o.value === option) ? (option as SnoozeOption) : null)
  )
  ipcMain.handle('mail:send', (_e, draft: unknown) => {
    const d = normalizeDraft(draft)
    if (typeof d === 'string') throw new Error(d)
    return mail.send(d)
  })
  ipcMain.handle('mail:reply-draft', async (_e, a: unknown, m: unknown, all: unknown) => mail.replyDraft(await accounts.message(id(a), id(m)), all === true))
  ipcMain.handle('mail:reply-ideas', (_e, a: unknown, m: unknown) => {
    const account = accounts.list().find((x) => x.id === a)
    return mail.replyIdeas(id(a), id(m), store.load().displayName || account?.name || account?.email || 'the recipient')
  })
  ipcMain.handle('mail:summary', (_e, a: unknown, m: unknown) => mail.summary(id(a), id(m)))
  ipcMain.handle('mail:unsubscribe', (_e, a: unknown, m: unknown) => mail.unsubscribe(id(a), id(m)))
  ipcMain.handle('mail:task', async (_e, a: unknown, m: unknown, task: unknown) => {
    const t = (task ?? {}) as Record<string, unknown>
    const body = await accounts.message(id(a), id(m))
    const link = mail.loaded(id(m))?.webUrl
    return jira.createTask(store.load(), String(t.siteId ?? ''), String(t.projectKey ?? '').trim().toUpperCase(), String(t.summary ?? '').trim() || body.subject, taskDescription(body, link))
  })
  ipcMain.handle('mail:propose-rules', () => mail.proposeRules(store.load()))
  ipcMain.handle('mail:learned', () => mail.learned())
  ipcMain.handle('mail:reset-feedback', () => mail.resetFeedback())
  ipcMain.handle('accounts:events', () => accounts.upcomingEvents())
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
