import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb, closeDb } from './storage/db'
import { registerAgentsIpc } from './ipc/agents.ipc'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerRunnerIpc } from './ipc/runner.ipc'
import { registerAuditIpc } from './ipc/audit.ipc'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      // Security hardening — renderer cannot access Node APIs directly
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Preload script exposes only the typed IPC bridge
      preload: join(__dirname, '../preload/index.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Disable remote module (deprecated but belt-and-suspenders)
      enableRemoteModule: false
    } as Electron.WebPreferences & { enableRemoteModule?: boolean }
  })

  // ── Content Security Policy ──────────────────────────────────────────────────
  // Only enforce strict CSP in production. In dev mode Vite's HMR requires
  // WebSocket connections and inline scripts that a strict CSP would block,
  // causing a black screen.
  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'", // Tailwind requires inline styles
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "frame-src 'none'",
              "object-src 'none'"
            ].join('; ')
          ]
        }
      })
    })
  }

  // ── Block external navigation ─────────────────────────────────────────────────
  // Prevent the renderer from navigating to external URLs
  win.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url)
    const isLocalDev = is.dev && (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1'))
    const isFileProtocol = parsedUrl.protocol === 'file:'

    if (!isLocalDev && !isFileProtocol) {
      event.preventDefault()
      // Open external links in the system browser instead
      shell.openExternal(url)
    }
  })

  // Block new window creation from renderer (no popups)
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  // Show window once ready to avoid white flash
  win.on('ready-to-show', () => {
    win.show()
    // Open DevTools in dev so renderer errors are visible immediately
    if (is.dev) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.agentbuilder.app')

  // Initialize database
  try {
    initDb()
    console.log('[main] Database initialized')
  } catch (err) {
    console.error('[main] Failed to initialize database:', err)
    app.quit()
    return
  }

  // Register all IPC handlers
  registerAgentsIpc()
  registerSettingsIpc()
  registerRunnerIpc()
  registerAuditIpc()

  // Default shortcut optimization (removes DevTools shortcut in production)
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDb()
})

// Prevent second instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}
