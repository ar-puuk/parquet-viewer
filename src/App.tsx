import { useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DropZone } from './components/loader/DropZone'
import { SchemaSidebar } from './components/layout/SchemaSidebar'
import { SplitLayout } from './components/layout/SplitLayout'
import { DataTable } from './components/table/DataTable'
import { MapView } from './components/map/MapView'
import { SqlPanel } from './components/sql/SqlPanel'
import { useAppStore } from './store/useAppStore'
import { useGeoData } from './hooks/useGeoData'
import type { GeoInfo } from './types'

// Ensure DuckDB initialization starts at app load
import './hooks/useDuckDB'

// ── CRS overlay ───────────────────────────────────────────────────────────────

function CrsOverlay({ geoInfo }: { geoInfo: GeoInfo }) {
  const setGeoEpsg = useAppStore((s) => s.setGeoEpsg)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState('')

  const isWgs84 = geoInfo.epsg === null || geoInfo.epsg === 4326
  const label = geoInfo.epsg === null
    ? 'CRS unknown'
    : geoInfo.epsg === 4326
    ? 'WGS 84'
    : `EPSG:${geoInfo.epsg}`

  function applyEpsg(e: React.FormEvent) {
    e.preventDefault()
    const n = parseInt(input.replace(/\s/g, '').replace(/^EPSG:/i, ''), 10)
    if (!Number.isFinite(n) || n <= 0 || n > 999999) {
      setInputError('Enter a valid EPSG code, e.g. 26912')
      return
    }
    setGeoEpsg(n)
    setEditing(false)
    setInput('')
    setInputError('')
  }

  if (editing) {
    return (
      <div className="absolute bottom-8 left-2 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="text-gray-600 dark:text-gray-300 mb-1.5 font-medium">Source CRS (EPSG code)</p>
        <form onSubmit={applyEpsg} className="flex items-center gap-1.5">
          <input
            autoFocus
            value={input}
            onChange={(e) => { setInput(e.target.value); setInputError('') }}
            placeholder="e.g. 26912"
            className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
          />
          <button
            type="submit"
            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setInput(''); setInputError('') }}
            className="px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs"
          >
            Cancel
          </button>
        </form>
        {inputError && <p className="text-red-500 mt-1">{inputError}</p>}
      </div>
    )
  }

  return (
    <div className="absolute bottom-8 left-2 z-20">
      <button
        onClick={() => { setEditing(true); setInput(geoInfo.epsg ? String(geoInfo.epsg) : '') }}
        title="Click to set source CRS"
        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium shadow backdrop-blur-sm border transition-colors ${
          isWgs84
            ? 'bg-white/80 dark:bg-gray-900/80 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            : 'bg-amber-50/90 dark:bg-amber-950/90 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900'
        }`}
      >
        {!isWgs84 && (
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 flex-shrink-0">
            <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 9V5h2v4H7zm0 2v-1.5h2V11H7z" clipRule="evenodd" />
          </svg>
        )}
        {label}
        {!isWgs84 && <span className="opacity-60">→ WGS 84</span>}
        <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 opacity-50 flex-shrink-0">
          <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}

// ── Inner layout rendered when a file is loaded ──────────────────────────────

function FileLayout() {
  const geoInfo     = useAppStore((s) => s.geoInfo)
  const queryResult = useAppStore((s) => s.queryResult)
  const setSelectedRowId = useAppStore((s) => s.setSelectedRowId)

  const { features, error: geoError } = useGeoData(geoInfo)

  const crsWarning = geoInfo && !geoInfo.isWGS84 && geoInfo.crsString ? geoInfo.crsString : null

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* SQL / Builder — left sidebar */}
      <SqlPanel />

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Main content area changes based on file type + query state */}
        {geoInfo ? (
          // ── Spatial file ──────────────────────────────────────────────────
          queryResult ? (
            // Query has run: split map + table
            <SplitLayout
              crsWarning={crsWarning}
              mapSlot={
                <div className="relative w-full h-full">
                  <MapView
                    features={features}
                    initialBbox={geoInfo.bbox}
                    onFeatureClick={(rowId) => setSelectedRowId(rowId)}
                  />
                  <CrsOverlay geoInfo={geoInfo} />
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
              {crsWarning && (
                <div className="absolute top-0 left-0 right-0 z-20 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                  Non-WGS84 CRS detected: {crsWarning}. Map may not render correctly.
                </div>
              )}
              <MapView
                features={[]}
                initialBbox={geoInfo.bbox}
                onFeatureClick={(rowId) => setSelectedRowId(rowId)}
              />
              <CrsOverlay geoInfo={geoInfo} />
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
