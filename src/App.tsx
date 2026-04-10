import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DropZone } from './components/loader/DropZone'
import { SchemaSidebar } from './components/layout/SchemaSidebar'
import { SplitLayout } from './components/layout/SplitLayout'
import { DataTable } from './components/table/DataTable'
import { MapView } from './components/map/MapView'
import { useAppStore } from './store/useAppStore'
import { useGeoData } from './hooks/useGeoData'

// Ensure DuckDB initialization starts at app load
import './hooks/useDuckDB'

function GeoViewerLayout() {
  const activeFile = useAppStore((s) => s.activeFile)
  const schema = useAppStore((s) => s.schema)
  const geoInfo = useAppStore((s) => s.geoInfo)
  const setSelectedRowId = useAppStore((s) => s.setSelectedRowId)
  const { features, loading: geoLoading, error: geoError } = useGeoData(geoInfo, schema)

  const crsWarning = geoInfo && !geoInfo.isWGS84 ? geoInfo.crsString : null

  return (
    <div className="flex-1 flex overflow-hidden">
      <SchemaSidebar />
      <SplitLayout
        crsWarning={crsWarning}
        mapSlot={
          <div className="relative w-full h-full">
            <MapView
              features={features}
              onFeatureClick={(rowId) => setSelectedRowId(rowId)}
            />
            {geoLoading && (
              <div className="absolute bottom-2 left-2 bg-white dark:bg-gray-900 text-xs text-gray-600 dark:text-gray-400 px-2 py-1 rounded shadow flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3 text-indigo-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading geometry…
              </div>
            )}
            {geoError && (
              <div className="absolute bottom-2 left-2 bg-red-50 dark:bg-red-950 text-xs text-red-600 dark:text-red-400 px-2 py-1 rounded shadow">
                {geoError}
              </div>
            )}
          </div>
        }
        tableSlot={<DataTable key={activeFile?.registeredAs} />}
      />
    </div>
  )
}

function TabularViewerLayout() {
  const activeFile = useAppStore((s) => s.activeFile)
  return (
    <div className="flex-1 flex overflow-hidden">
      <SchemaSidebar />
      <DataTable key={activeFile?.registeredAs} />
    </div>
  )
}

function HomePage() {
  const activeFile = useAppStore((s) => s.activeFile)
  const geoInfo = useAppStore((s) => s.geoInfo)

  if (!activeFile) return <DropZone />
  if (geoInfo) return <GeoViewerLayout />
  return <TabularViewerLayout />
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
