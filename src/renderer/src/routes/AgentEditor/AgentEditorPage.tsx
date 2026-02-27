import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Save, AlertCircle } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'

export default function AgentEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { currentAgent, currentAgentLoading, currentAgentDirty, loadAgent, saveCurrentAgent } =
    useAgentStore()

  useEffect(() => {
    if (id) loadAgent(id)
  }, [id, loadAgent])

  if (currentAgentLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading agent...
      </div>
    )
  }

  if (!currentAgent) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-muted-foreground">Agent not found</p>
        <button
          onClick={() => navigate('/agents')}
          className="text-sm text-primary hover:underline"
        >
          Back to agents
        </button>
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

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{currentAgent.name}</h2>
          <p className="text-xs text-muted-foreground">
            {currentAgent.provider.provider} · {currentAgent.provider.model}
          </p>
        </div>

        {currentAgentDirty && (
          <span className="text-xs text-amber-400 font-medium">Unsaved changes</span>
        )}

        <button
          onClick={saveCurrentAgent}
          disabled={!currentAgentDirty}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          Save
        </button>

        <button
          onClick={() => navigate(`/agents/${id}/run`)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          <Play className="w-3.5 h-3.5" />
          Run
        </button>
      </div>

      {/* Placeholder canvas — Phase 2 will add React Flow */}
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center mx-auto">
            <div className="w-8 h-8 grid grid-cols-2 gap-1">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="w-3 h-3 rounded-sm bg-muted" />
              ))}
            </div>
          </div>
          <div>
            <p className="text-foreground font-medium">Node Graph Editor</p>
            <p className="text-sm text-muted-foreground">Phase 2 — Coming soon</p>
            <p className="text-xs text-muted-foreground mt-2 max-w-xs">
              The visual node graph editor with code block support will be implemented in Phase 2.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
