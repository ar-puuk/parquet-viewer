import { useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DropZone } from './components/loader/DropZone'
import { SchemaSidebar } from './components/layout/SchemaSidebar'
import { SplitLayout } from './components/layout/SplitLayout'
import { DataTable } from './components/table/DataTable'
import { MapView } from './components/map/MapView'
import { useAppStore } from './store/useAppStore'
import { useGeoData, GEO_PAGE_SIZE } from './hooks/useGeoData'

// Ensure DuckDB initialization starts at app load
import './hooks/useDuckDB'

function GeoPagination({
  page,
  totalPages,
  loading,
  onPage,
}: {
  page: number
  totalPages: number
  loading: boolean
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null

  // Build page window: always show first, last, current ± 1, with ellipsis
  const pages: (number | '…')[] = []
  const addPage = (p: number) => {
    if (pages[pages.length - 1] !== p) pages.push(p)
  }
  addPage(0)
  if (page > 2) pages.push('…')
  for (let p = Math.max(1, page - 1); p <= Math.min(totalPages - 2, page + 1); p++) addPage(p)
  if (page < totalPages - 3) pages.push('…')
  if (totalPages > 1) addPage(totalPages - 1)

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 shadow-lg">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 0 || loading}
        className="px-1.5 py-0.5 text-xs rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:cursor-not-allowed"
        aria-label="Previous page"
      >
        ←
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            disabled={loading}
            className={`min-w-[24px] px-1.5 py-0.5 text-xs rounded transition-colors disabled:cursor-not-allowed ${
              p === page
                ? 'bg-indigo-600 text-white'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'
            }`}
          >
            {p + 1}
          </button>
        )
      )}

      <button
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages - 1 || loading}
        className="px-1.5 py-0.5 text-xs rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:cursor-not-allowed"
        aria-label="Next page"
      >
        →
      </button>

      {loading && (
        <svg className="ml-1 animate-spin w-3 h-3 text-indigo-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
    </div>
  )
}

function GeoViewerLayout() {
  const activeFile = useAppStore((s) => s.activeFile)
  const schema = useAppStore((s) => s.schema)
  const geoInfo = useAppStore((s) => s.geoInfo)
  const setSelectedRowId = useAppStore((s) => s.setSelectedRowId)
  const fileStats = useAppStore((s) => s.fileStats)

  const [page, setPage] = useState(0)

  const { features, totalCount, loading: geoLoading, error: geoError } =
    useGeoData(geoInfo, schema, page)

  // Use fileStats.rowCount for total (already fetched), fall back to totalCount from geo hook
  const rowCount = fileStats?.rowCount ?? totalCount
  const totalPages = rowCount > 0 ? Math.ceil(rowCount / GEO_PAGE_SIZE) : 0

  const crsWarning = geoInfo && !geoInfo.isWGS84 ? geoInfo.crsString : null

  function handlePage(p: number) {
    if (p < 0 || p >= totalPages || geoLoading) return
    setPage(p)
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <SchemaSidebar />
      <SplitLayout
        crsWarning={crsWarning}
        mapSlot={
          <div className="relative w-full h-full">
            <MapView
              features={features}
              fitKey={page}
              onFeatureClick={(rowId) => setSelectedRowId(rowId)}
            />
            <GeoPagination
              page={page}
              totalPages={totalPages}
              loading={geoLoading}
              onPage={handlePage}
            />
            {geoError && (
              <div className="absolute bottom-12 left-2 bg-red-50 dark:bg-red-950 text-xs text-red-600 dark:text-red-400 px-2 py-1 rounded shadow">
                {geoError}
              </div>
            )}
            {/* Row range label */}
            {rowCount > 0 && (
              <div className="absolute top-2 right-2 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm text-[10px] text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                rows {(page * GEO_PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * GEO_PAGE_SIZE, rowCount).toLocaleString()} of {rowCount.toLocaleString()}
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
