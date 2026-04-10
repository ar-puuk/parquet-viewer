import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DropZone } from './components/loader/DropZone'
import { SchemaSidebar } from './components/layout/SchemaSidebar'
import { useAppStore } from './store/useAppStore'

// Import useDuckDB to ensure initialization starts at app load
import './hooks/useDuckDB'

function ViewerLayout() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <SchemaSidebar />
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
        Table view coming in Phase 3
      </div>
    </div>
  )
}

function HomePage() {
  const activeFile = useAppStore((s) => s.activeFile)
  return activeFile ? <ViewerLayout /> : <DropZone />
}

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </AppShell>
    </HashRouter>
  )
}
