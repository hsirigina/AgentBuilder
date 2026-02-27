/**
 * Settings storage using SQLite + Electron safeStorage.
 *
 * Plain settings (theme, preferences) are stored in the `settings` SQLite table.
 * Sensitive secrets (API keys) are encrypted with Electron's safeStorage
 * (OS keychain on macOS/Windows, libsecret on Linux) and stored as base64
 * blobs in the same table under prefixed keys.
 *
 * This avoids electron-store which is ESM-only and breaks CJS bundling.
 */

import { safeStorage } from 'electron'
import { getDb } from './db'
import type { AppSettings } from '@shared/types/ipc.types'

const SECRET_PREFIX = 'secret:'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultProvider: 'anthropic',
  auditRetentionDays: 30,
  confirmDestructiveActions: true
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function dbGet(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function dbSet(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

function dbDelete(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

// ── App settings ──────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  const stored = dbGet('app_settings')
  if (!stored) return DEFAULT_SETTINGS
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  const current = getSettings()
  dbSet('app_settings', JSON.stringify({ ...current, [key]: value }))
}

// ── Encrypted secrets (API keys) ──────────────────────────────────────────────

export function setSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[settings] safeStorage unavailable — storing API key without encryption')
    dbSet(SECRET_PREFIX + key, 'PLAIN:' + value)
    return
  }
  const encrypted = safeStorage.encryptString(value)
  dbSet(SECRET_PREFIX + key, encrypted.toString('base64'))
}

export function getSecret(key: string): string | null {
  const stored = dbGet(SECRET_PREFIX + key)
  if (!stored) return null

  if (stored.startsWith('PLAIN:')) {
    return stored.slice(6)
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[settings] safeStorage unavailable — cannot decrypt secret')
    return null
  }

  try {
    const buf = Buffer.from(stored, 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    console.error(`[settings] Failed to decrypt secret: ${key}`)
    return null
  }
}

export function deleteSecret(key: string): void {
  dbDelete(SECRET_PREFIX + key)
}

export function listSecretKeys(): string[] {
  const rows = getDb()
    .prepare('SELECT key FROM settings WHERE key LIKE ?')
    .all(SECRET_PREFIX + '%') as { key: string }[]
  return rows.map((r) => r.key.slice(SECRET_PREFIX.length))
}
