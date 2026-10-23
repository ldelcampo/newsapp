import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { SettingsStore } from './settings-store'

let store: SettingsStore

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
  nativeTheme.themeSource = store.load().theme

  ipcMain.handle('settings:get', () => store.load())
  ipcMain.handle('settings:save', (_e, next: unknown) => {
    const saved = store.save(next)
    nativeTheme.themeSource = saved.theme
    return saved
  })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: app.getPath('userData')
  }))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
