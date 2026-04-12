import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DropZone } from './components/loader/DropZone'
import { SchemaSidebar } from './components/layout/SchemaSidebar'
import { SplitLayout } from './components/layout/SplitLayout'
import { DataTable } from './components/table/DataTable'
import { MapView } from './components/map/MapView'
import { CrsPanel } from './components/map/CrsPanel'
import { SqlPanel } from './components/sql/SqlPanel'
import { useAppStore } from './store/useAppStore'
import { useGeoData } from './hooks/useGeoData'

// Ensure DuckDB initialization starts at app load
import './hooks/useDuckDB'

// ── Inner layout rendered when a file is loaded ──────────────────────────────

function FileLayout() {
  const geoInfo      = useAppStore((s) => s.geoInfo)
  const queryResult  = useAppStore((s) => s.queryResult)
  const setSelectedRowId = useAppStore((s) => s.setSelectedRowId)

  const { features, error: geoError } = useGeoData(geoInfo)

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* SQL / Builder — left sidebar */}
      <SqlPanel />

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* CRS drawer — self-hides unless a non-WGS84 spatial file is loaded */}
        <CrsPanel />

        {/* Main content area changes based on file type + query state */}
        {geoInfo ? (
          // ── Spatial file ──────────────────────────────────────────────────
          queryResult ? (
            // Query has run: split map + table
            <SplitLayout
              mapSlot={
                <div className="relative w-full h-full">
                  <MapView
                    features={features}
                    initialBbox={geoInfo.bbox}
                    onFeatureClick={(rowId) => setSelectedRowId(rowId)}
                  />
                  {geoError && (
                    <div className="absolute bottom-4 left-2 bg-red-50 dark:bg-red-950 text-xs text-red-600 dark:text-red-400 px-2 py-1 rounded shadow">
                      {geoError}
                    </div>
                  )}
                </div>
              }
              tableSlot={<DataTable />}
            />
          ) : (
            // No query yet: map fills the space, waiting for user to run query
            <div className="relative flex-1 overflow-hidden">
              <MapView
                features={[]}
                initialBbox={geoInfo.bbox}
                onFeatureClick={(rowId) => setSelectedRowId(rowId)}
              />
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-xs text-gray-500 dark:text-gray-400 shadow-lg pointer-events-none select-none">
                Run the query above to load features
              </div>
            </div>
          )
        ) : (
          // ── Tabular file ──────────────────────────────────────────────────
          queryResult ? (
            <DataTable />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-950">
              <p className="text-sm text-gray-400 dark:text-gray-600 select-none">
                Run the query above to load data
              </p>
            </div>
          )
        )}
      </div>

      {/* Schema — right sidebar */}
      <SchemaSidebar />
    </div>
  )
}

// ── Home page ────────────────────────────────────────────────────────────────

function HomePage() {
  const activeFile = useAppStore((s) => s.activeFile)
  if (!activeFile) return <DropZone />
  return <FileLayout />
}

// ── App root ─────────────────────────────────────────────────────────────────

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
