import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/api'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }

/** GitHub answers 404 until the first build is published; that is not a failure for the user. */
function friendly(e: Error): UpdateState {
  if (/404|No published versions|Unable to find latest version|latest-mac\.yml|latest\.yml/i.test(e.message)) return { status: 'none' }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::ERR_/i.test(e.message)) return { status: 'error', message: 'No connection to GitHub. Try again later.' }
  return { status: 'error', message: e.message.split('\n')[0].slice(0, 160) }
}

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
  ipcMain.handle('update:check', async (): Promise<UpdateState> => {
    if (!app.isPackaged) return { status: 'dev' }
    // Opened straight from Downloads or the disk image, macOS runs a read-only copy that can't be replaced.
    if (process.platform === 'darwin' && !app.isInApplicationsFolder()) return { status: 'move' }
    // A check while downloading or ready would only interrupt; report where it stands.
    if (state.status === 'downloading' || state.status === 'ready') return state
    publish({ status: 'checking' })
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      publish(friendly(e as Error))
    }
    // Guard against a check that ends without an event.
    if (state.status === 'checking') publish({ status: 'current' })
    return state
  })

  if (!app.isPackaged) return

  // Testing builds are published as pre-releases.
  autoUpdater.allowPrerelease = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => publish({ status: 'current' }))
  autoUpdater.on('download-progress', (p) => publish({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => publish(friendly(e)))

  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined)
  check()
  setInterval(check, CHECK_EVERY_MS)
}
