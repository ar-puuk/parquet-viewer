import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DropZone } from './components/loader/DropZone'
import { SchemaSidebar } from './components/layout/SchemaSidebar'
import { DataTable } from './components/table/DataTable'
import { useAppStore } from './store/useAppStore'

// Ensure DuckDB initialization starts at app load
import './hooks/useDuckDB'

function ViewerLayout() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <SchemaSidebar />
      <DataTable />
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
