/**
 * Runtime smoke-test for the compiled main process bundle.
 *
 * Loads out/main/index.js in plain Node.js with Electron APIs stubbed out
 * to catch constructor errors and ESM/CJS interop issues before you run
 * `npm run dev`.
 *
 * Limitations (what this script CANNOT catch):
 * - Native module ABI mismatches (better-sqlite3 compiled for wrong Node version)
 *   → Fixed by the postinstall hook which runs `electron-rebuild` automatically
 *     after every `npm install`. If you see this error, run: npx electron-rebuild
 * - Crashes that only happen inside the real Electron runtime
 *
 * Usage: npm run check
 */

const Module = require('module')
const path = require('path')
const fs = require('fs')

const bundlePath = path.join(__dirname, '../out/main/index.js')

if (!fs.existsSync(bundlePath)) {
  console.error('❌  out/main/index.js not found — run `npm run build` first')
  process.exit(1)
}

console.log('🔍  Checking main process bundle for load errors...')

// Stub Electron APIs so the bundle loads without a real Electron process
const electronStub = {
  app: {
    getPath: (name) => {
      const os = require('os')
      return path.join(os.tmpdir(), 'agentbuilder-check', name)
    },
    on: () => {},
    whenReady: () => Promise.resolve(),
    quit: () => {},
    requestSingleInstanceLock: () => true,
    setAppUserModelId: () => {}
  },
  BrowserWindow: class {
    constructor() {}
    on() {}
    loadURL() {}
    loadFile() {}
    show() {}
    static getAllWindows() { return [] }
  },
  ipcMain: { handle: () => {}, on: () => {} },
  session: {
    defaultSession: { webRequest: { onHeadersReceived: () => {} } }
  },
  shell: { openExternal: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
}

// Stub native modules that can't load outside of Electron's runtime
// (their ABI is compiled for Electron's Node, not system Node)
const betterSqlite3Stub = class Database {
  constructor() {}
  pragma() { return this }
  exec() { return this }
  prepare() {
    return { run: () => ({ changes: 0 }), get: () => null, all: () => [] }
  }
  close() {}
  transaction(fn) { return fn }
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub
  if (request === 'better-sqlite3') return betterSqlite3Stub
  return originalLoad.apply(this, arguments)
}

try {
  require(bundlePath)
  console.log('✅  No ESM/CJS or constructor errors found.')
  console.log('')
  console.log('    If you see "compiled against a different Node.js version"')
  console.log('    when running npm run dev, fix it with: npx electron-rebuild')
  console.log('')
  console.log('▶   Ready to launch: npm run dev')
  process.exit(0)
} catch (err) {
  console.error('\n❌  Main process bundle failed to load:\n')
  console.error(err.message)
  const relevantStack = (err.stack || '')
    .split('\n')
    .filter((line) => !line.includes('node:internal'))
    .join('\n')
  console.error(relevantStack)
  process.exit(1)
}
