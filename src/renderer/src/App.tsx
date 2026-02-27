import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useRunnerStore } from './stores/runnerStore'
import { ipc } from './lib/ipc-client'
import AgentListPage from './routes/AgentList/AgentListPage'
import AgentEditorPage from './routes/AgentEditor/AgentEditorPage'
import AgentRunnerPage from './routes/AgentRunner/AgentRunnerPage'
import SettingsPage from './routes/Settings/SettingsPage'
import Sidebar from './components/Sidebar'

export default function App(): JSX.Element {
  const handleEvent = useRunnerStore((s) => s.handleEvent)

  // Subscribe to runner events from the main process on app mount
  useEffect(() => {
    const unsubscribe = ipc.runner.onEvent(handleEvent)
    return unsubscribe
  }, [handleEvent])

  return (
    <HashRouter>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/agents" replace />} />
            <Route path="/agents" element={<AgentListPage />} />
            <Route path="/agents/:id/edit" element={<AgentEditorPage />} />
            <Route path="/agents/:id/run" element={<AgentRunnerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
