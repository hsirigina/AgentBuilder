import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Play, Pencil, Trash2, Search, Tag, Plus } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import { cn, formatDate } from '../../lib/utils'
import type { AgentSummary } from '@shared/types/ipc.types'
import CreateAgentDialog from '../../components/CreateAgentDialog'

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  openai: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  ollama: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  custom: 'bg-blue-500/15 text-blue-400 border-blue-500/20'
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  ollama: 'Ollama',
  custom: 'Custom'
}

export default function AgentListPage(): JSX.Element {
  const navigate = useNavigate()
  const { summaries, summariesLoading, summariesError, loadSummaries, deleteAgent } = useAgentStore()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    loadSummaries()
  }, [loadSummaries])

  const filtered = summaries.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  )

  const handleDelete = async (agent: AgentSummary, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!window.confirm(`Delete "${agent.name}"? This cannot be undone.`)) return
    setDeletingId(agent.id)
    try {
      await deleteAgent(agent.id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border flex items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Agents</h1>
          <p className="text-sm text-muted-foreground">
            {summaries.length} agent{summaries.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-9 pr-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring selectable"
          />
        </div>

        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors ml-auto"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {summariesLoading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading agents...
          </div>
        )}

        {summariesError && (
          <div className="flex items-center justify-center h-48">
            <p className="text-destructive text-sm">{summariesError}</p>
          </div>
        )}

        {!summariesLoading && !summariesError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center">
              <Bot className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-foreground font-medium">
                {search ? 'No agents match your search' : 'No agents yet'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {search ? 'Try a different search term' : 'Create your first agent to get started'}
              </p>
            </div>
            {!search && (
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Agent
              </button>
            )}
          </div>
        )}

        {!summariesLoading && !summariesError && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                deleting={deletingId === agent.id}
                onEdit={() => navigate(`/agents/${agent.id}/edit`)}
                onRun={() => navigate(`/agents/${agent.id}/run`)}
                onDelete={(e) => handleDelete(agent, e)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateAgentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

interface AgentCardProps {
  agent: AgentSummary
  deleting: boolean
  onEdit: () => void
  onRun: () => void
  onDelete: (e: React.MouseEvent) => void
}

function AgentCard({ agent, deleting, onEdit, onRun, onDelete }: AgentCardProps): JSX.Element {
  const providerClass = PROVIDER_COLORS[agent.provider] ?? PROVIDER_COLORS.custom
  const providerLabel = PROVIDER_LABELS[agent.provider] ?? agent.provider

  return (
    <div
      className={cn(
        'group relative bg-card border border-border rounded-xl p-4 flex flex-col gap-3',
        'hover:border-primary/40 transition-colors cursor-pointer',
        deleting && 'opacity-50 pointer-events-none'
      )}
      onClick={onEdit}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5 text-primary" />
        </div>

        {/* Action buttons (shown on hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onRun() }}
            title="Run agent"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            title="Edit agent"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            title="Delete agent"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Name + description */}
      <div>
        <h3 className="font-medium text-foreground text-sm leading-tight">{agent.name}</h3>
        {agent.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{agent.description}</p>
        )}
      </div>

      {/* Footer metadata */}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', providerClass)}>
          {providerLabel}
        </span>

        {agent.enabledToolCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {agent.enabledToolCount} tool{agent.enabledToolCount !== 1 ? 's' : ''}
          </span>
        )}

        {agent.tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <Tag className="w-2.5 h-2.5" />
            {tag}
          </span>
        ))}
      </div>

      <div className="text-xs text-muted-foreground/60">
        Updated {formatDate(agent.updatedAt)}
      </div>

      {/* Quick run button (bottom overlay) */}
      <button
        onClick={(e) => { e.stopPropagation(); onRun() }}
        className="absolute bottom-0 left-0 right-0 h-10 bg-primary/90 text-primary-foreground rounded-b-xl text-sm font-medium flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Play className="w-3.5 h-3.5" />
        Run Agent
      </button>
    </div>
  )
}
