import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Square, Send, Trash2, AlertCircle } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import { useRunnerStore } from '../../stores/runnerStore'
import { cn } from '../../lib/utils'

export default function AgentRunnerPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { currentAgent, loadAgent } = useAgentStore()
  const { isRunning, consoleEntries, pendingConfirmation, startRun, stopRun, respondToConfirmation, clearConsole } =
    useRunnerStore()
  const [message, setMessage] = useState('')
  const consoleEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (id && (!currentAgent || currentAgent.id !== id)) {
      loadAgent(id)
    }
  }, [id, currentAgent, loadAgent])

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleEntries])

  const handleSend = async (): Promise<void> => {
    if (!message.trim() || !id || isRunning) return
    const msg = message.trim()
    setMessage('')
    await startRun(id, msg)
  }

  if (!currentAgent && !id) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Agent not found</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <button
          onClick={() => navigate('/agents')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            {currentAgent?.name ?? 'Agent Runner'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isRunning ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Running...
              </span>
            ) : (
              'Ready'
            )}
          </p>
        </div>

        {isRunning ? (
          <button
            onClick={stopRun}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            Stop
          </button>
        ) : (
          <button
            onClick={clearConsole}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Console */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {consoleEntries.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">Send a message to start the agent</p>
          </div>
        )}

        {consoleEntries.map((entry) => (
          <div
            key={entry.id}
            className={cn('flex gap-3', entry.type === 'user' && 'justify-end')}
          >
            {entry.type !== 'user' && (
              <div
                className={cn(
                  'w-2 h-2 rounded-full mt-1.5 shrink-0',
                  entry.type === 'assistant' && 'bg-primary',
                  entry.type === 'tool' && 'bg-amber-400',
                  entry.type === 'system' && 'bg-muted-foreground',
                  entry.type === 'error' && 'bg-destructive',
                  entry.type === 'warning' && 'bg-amber-400'
                )}
              />
            )}

            <div
              className={cn(
                'rounded-xl px-3 py-2 text-sm max-w-2xl',
                entry.type === 'user' &&
                  'bg-primary text-primary-foreground',
                entry.type === 'assistant' &&
                  'bg-card border border-border text-foreground font-mono text-xs leading-relaxed whitespace-pre-wrap selectable',
                entry.type === 'tool' &&
                  'bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono text-xs selectable',
                entry.type === 'system' &&
                  'bg-muted text-muted-foreground text-xs',
                entry.type === 'error' &&
                  'bg-destructive/10 border border-destructive/20 text-destructive text-xs',
                entry.type === 'warning' &&
                  'bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs'
              )}
            >
              {entry.content}
            </div>
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>

      {/* Confirmation dialog */}
      {pendingConfirmation && (
        <div className="mx-4 mb-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300">{pendingConfirmation.action}</p>
              <p className="text-xs text-muted-foreground mt-1">{pendingConfirmation.description}</p>
              {pendingConfirmation.command && (
                <code className="text-xs font-mono bg-black/30 px-2 py-0.5 rounded mt-1 block selectable">
                  {pendingConfirmation.command}
                </code>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3 justify-end">
            <button
              onClick={() => respondToConfirmation('deny')}
              className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              Deny
            </button>
            <button
              onClick={() => respondToConfirmation('allow-session')}
              className="px-3 py-1.5 text-xs rounded-lg border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-colors"
            >
              Allow for Session
            </button>
            <button
              onClick={() => respondToConfirmation('allow-once')}
              className="px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-black font-medium hover:bg-amber-400 transition-colors"
            >
              Allow Once
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="px-4 pb-4 pt-2 border-t border-border">
        <div className="flex gap-3 items-end">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
            rows={1}
            disabled={isRunning || !!pendingConfirmation}
            className="flex-1 px-3 py-2.5 bg-input border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring selectable resize-none disabled:opacity-50"
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || isRunning || !!pendingConfirmation}
            className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
