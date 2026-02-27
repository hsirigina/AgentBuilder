import { NavLink } from 'react-router-dom'
import { Bot, Settings, Plus } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAgentStore } from '../stores/agentStore'
import { useState } from 'react'
import CreateAgentDialog from './CreateAgentDialog'

export default function Sidebar(): JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <>
      <aside className="w-14 flex flex-col items-center py-4 gap-2 border-r border-border bg-card shrink-0">
        {/* Logo */}
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mb-2">
          <Bot className="w-5 h-5 text-primary-foreground" />
        </div>

        <div className="flex-1 flex flex-col items-center gap-1 w-full px-2">
          <NavLink to="/agents" title="Agents">
            {({ isActive }) => (
              <button
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Bot className="w-5 h-5" />
              </button>
            )}
          </NavLink>
        </div>

        <div className="flex flex-col items-center gap-1 w-full px-2">
          <button
            onClick={() => setCreateOpen(true)}
            title="New Agent"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>

          <NavLink to="/settings" title="Settings">
            {({ isActive }) => (
              <button
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
          </NavLink>
        </div>
      </aside>

      <CreateAgentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}
