import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/api'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }

function publish(next: UpdateState): void {
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', state)
}

/**
 * Checks GitHub Releases for a newer signed build, downloads it in the background and
 * lets the user restart into it. Only packaged builds update; `npm run dev` never does.
 */
export function startUpdater(): void {
  ipcMain.handle('update:get', () => state)
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
  ipcMain.handle('update:check', () => (app.isPackaged ? autoUpdater.checkForUpdates().then(() => state) : state))

  if (!app.isPackaged) return

  // Testing builds are published as pre-releases.
  autoUpdater.allowPrerelease = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => publish({ status: 'current' }))
  autoUpdater.on('download-progress', (p) => publish({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => publish({ status: 'error', message: e.message }))

  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined)
  check()
  setInterval(check, CHECK_EVERY_MS)
}
