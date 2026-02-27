import { useEffect, useState } from 'react'
import { Key, Shield, ClipboardList, Info, CheckCircle, XCircle, Loader } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { cn } from '../../lib/utils'
import { ipc, ipcCall } from '../../lib/ipc-client'

type Tab = 'api-keys' | 'permissions' | 'audit' | 'about'

export default function SettingsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('api-keys')
  const { load, loading } = useSettingsStore()

  useEffect(() => {
    load()
  }, [load])

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'api-keys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
    { id: 'permissions', label: 'Permissions', icon: <Shield className="w-4 h-4" /> },
    { id: 'audit', label: 'Audit Log', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> }
  ]

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading settings...
      </div>
    )
  }

  return (
    <div className="h-full flex">
      {/* Sidebar nav */}
      <aside className="w-48 border-r border-border p-4 shrink-0">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-3">
          Settings
        </h2>
        <nav className="space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === 'api-keys' && <ApiKeysTab />}
        {activeTab === 'permissions' && <PermissionsTab />}
        {activeTab === 'audit' && <AuditTab />}
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  )
}

// ── API Keys Tab ──────────────────────────────────────────────────────────────

interface ProviderKeyConfig {
  id: string
  label: string
  secretKey: string
  testProvider: string
  testModel: string
  placeholder: string
  docsUrl: string
}

const PROVIDER_KEYS: ProviderKeyConfig[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    secretKey: 'anthropic_api_key',
    testProvider: 'anthropic',
    testModel: 'claude-haiku-4-5-20251001',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    secretKey: 'openai_api_key',
    testProvider: 'openai',
    testModel: 'gpt-4o-mini',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys'
  }
]

function ApiKeysTab(): JSX.Element {
  const { secretKeys, loadSecretKeys, setSecret, deleteSecret } = useSettingsStore()

  useEffect(() => {
    loadSecretKeys()
  }, [loadSecretKeys])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">API Keys</h3>
        <p className="text-sm text-muted-foreground mt-1">
          API keys are encrypted using your OS keychain and never leave your device.
        </p>
      </div>

      {PROVIDER_KEYS.map((config) => (
        <ApiKeyRow
          key={config.id}
          config={config}
          exists={secretKeys.includes(config.secretKey)}
          onSave={setSecret}
          onDelete={deleteSecret}
        />
      ))}

      <div className="border border-border rounded-xl p-4 bg-card">
        <h4 className="text-sm font-medium text-foreground mb-1">Ollama (Local Models)</h4>
        <p className="text-xs text-muted-foreground">
          No API key needed. Ollama runs locally at{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-foreground">
            http://localhost:11434
          </code>
          . Install Ollama and run{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-foreground">
            ollama serve
          </code>{' '}
          to enable local models.
        </p>
        <OllamaTestButton />
      </div>
    </div>
  )
}

interface ApiKeyRowProps {
  config: ProviderKeyConfig
  exists: boolean
  onSave: (key: string, value: string) => Promise<void>
  onDelete: (key: string) => Promise<void>
}

function ApiKeyRow({ config, exists, onSave, onDelete }: ApiKeyRowProps): JSX.Element {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await onSave(config.secretKey, value.trim())
      setValue('')
      setEditing(false)
      setTestResult(null)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await ipcCall(
        ipc.settings.testProvider({
          provider: config.testProvider,
          apiKeyRef: config.secretKey,
          model: config.testModel
        })
      )
      setTestResult({
        success: result.success,
        message: result.success
          ? `Connected in ${result.latencyMs}ms`
          : result.error ?? 'Connection failed'
      })
    } catch (e) {
      setTestResult({ success: false, message: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!window.confirm(`Remove ${config.label} API key?`)) return
    await onDelete(config.secretKey)
    setTestResult(null)
  }

  return (
    <div className="border border-border rounded-xl p-4 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{config.label}</h4>
        {exists && !editing && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Saved
            </span>
          </div>
        )}
      </div>

      {!exists || editing ? (
        <div className="space-y-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder={config.placeholder}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring selectable font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!value.trim() || saving}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
            >
              {saving ? 'Saving...' : 'Save Key'}
            </button>
            {editing && (
              <button
                onClick={() => { setEditing(false); setValue('') }}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {testing ? (
              <Loader className="w-3 h-3 animate-spin" />
            ) : (
              <CheckCircle className="w-3 h-3" />
            )}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Replace Key
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
          >
            Remove
          </button>
        </div>
      )}

      {testResult && (
        <div
          className={cn(
            'flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
            testResult.success
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          )}
        >
          {testResult.success ? (
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 shrink-0" />
          )}
          {testResult.message}
        </div>
      )}
    </div>
  )
}

function OllamaTestButton(): JSX.Element {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    try {
      const r = await ipcCall(
        ipc.settings.testProvider({ provider: 'ollama', apiKeyRef: '', model: 'llama3.2' })
      )
      setResult({ success: r.success, message: r.success ? `Connected in ${r.latencyMs}ms` : r.error ?? 'Failed' })
    } catch (e) {
      setResult({ success: false, message: String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <button
        onClick={handleTest}
        disabled={testing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
      >
        {testing ? <Loader className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
        {testing ? 'Testing...' : 'Test Ollama Connection'}
      </button>
      {result && (
        <div className={cn('flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
          result.success ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-destructive/10 text-destructive border border-destructive/20'
        )}>
          {result.success ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {result.message}
        </div>
      )}
    </div>
  )
}

// ── Permissions Tab ───────────────────────────────────────────────────────────

function PermissionsTab(): JSX.Element {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Global Permission Defaults</h3>
        <p className="text-sm text-muted-foreground mt-1">
          These are the default security settings applied to new agents. Each agent can further
          restrict or configure its own permissions.
        </p>
      </div>

      <div className="border border-border rounded-xl divide-y divide-border bg-card">
        {[
          {
            title: 'All tools disabled by default',
            desc: 'New agents start with all tools (filesystem, HTTP, shell, code execution) disabled. Users must explicitly enable each tool.',
            active: true
          },
          {
            title: 'Require confirmation for destructive actions',
            desc: 'Shell commands, file writes, and HTTP POST/PUT/DELETE require user confirmation before executing.',
            active: true
          },
          {
            title: 'Secret detection in outputs',
            desc: 'Automatically redact API keys, tokens, and credentials detected in LLM outputs and tool results.',
            active: true
          },
          {
            title: 'Prompt injection detection',
            desc: 'Scan tool outputs for potential prompt injection patterns before returning them to the LLM.',
            active: true
          },
          {
            title: 'Block SSRF (private IP access)',
            desc: 'HTTP requests to private IP ranges (10.x, 172.16.x, 192.168.x, 127.x) are blocked by default.',
            active: true
          },
          {
            title: 'Audit logging',
            desc: 'Record all agent actions (tool calls, LLM calls, security events) to an append-only audit log.',
            active: true
          }
        ].map((item) => (
          <div key={item.title} className="flex items-start gap-4 px-4 py-4">
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Audit Tab ─────────────────────────────────────────────────────────────────

function AuditTab(): JSX.Element {
  const [entries, setEntries] = useState<{ id: number; ts: string; eventType: string; tool?: string; outcome: string; agentId: string }[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const result = await ipcCall(ipc.audit.query({ limit: 50 }))
        setEntries(result.entries as typeof entries)
        setTotal(result.total)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Audit Log</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {total} total event{total !== 1 ? 's' : ''} recorded
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : entries.length === 0 ? (
        <div className="border border-border rounded-xl p-8 text-center bg-card">
          <ClipboardList className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No audit events yet. Run an agent to see activity here.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Event</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Tool</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-2.5 text-muted-foreground font-mono">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{entry.eventType}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{entry.tool ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('px-1.5 py-0.5 rounded-full font-medium',
                      entry.outcome === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                      entry.outcome === 'error' ? 'bg-destructive/10 text-destructive' :
                      'bg-amber-500/10 text-amber-400'
                    )}>
                      {entry.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── About Tab ─────────────────────────────────────────────────────────────────

function AboutTab(): JSX.Element {
  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">AgentBuilder</h3>
        <p className="text-sm text-muted-foreground mt-1">Version 0.1.0</p>
      </div>

      <div className="border border-border rounded-xl p-4 bg-card space-y-3 text-sm text-muted-foreground">
        <p>
          A local desktop platform for building AI agents with visual node graphs and code blocks.
        </p>
        <p>
          All data stays on your device. API keys are encrypted using your OS keychain.
          Agent actions are sandboxed and require explicit permission grants.
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Security</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Electron sandbox + context isolation enabled</li>
          <li>All tools disabled by default (explicit opt-in)</li>
          <li>Code blocks run in isolated V8 sandbox (isolated-vm)</li>
          <li>API keys encrypted via OS keychain (safeStorage)</li>
          <li>Append-only audit log for all agent actions</li>
          <li>Automatic secret detection and redaction</li>
          <li>SSRF protection on HTTP requests</li>
        </ul>
      </div>
    </div>
  )
}
