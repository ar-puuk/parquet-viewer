import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useAppStore } from '../../store/useAppStore'

// ── Types ────────────────────────────────────────────────────────────────────

interface Projection {
  code: number
  name: string
  areaName: string
  units: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const DARK_STYLE  = 'https://tiles.openfreemap.org/styles/dark'
const API_URL     = 'https://projest.io/ns/api/'

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Collapsible drawer shown when a spatial file has non-WGS84 coordinates.
 *
 * Two tabs:
 *  "Find by location" — click a mini-map to query the projest.io API for
 *    suggestions appropriate to that geographic area.
 *  "Enter EPSG code"  — type an EPSG code directly.
 *
 * Once an EPSG is applied the drawer collapses to a single-line strip.
 * The user can re-open it via the "Change" button.
 */
export function CrsPanel() {
  // ── Store ──────────────────────────────────────────────────────────────────
  const geoInfo    = useAppStore((s) => s.geoInfo)
  const setGeoEpsg = useAppStore((s) => s.setGeoEpsg)
  const theme      = useAppStore((s) => s.theme)

  // ── Local state ────────────────────────────────────────────────────────────
  const [isExpanded, setIsExpanded]               = useState(false)
  const [activeTab, setActiveTab]                 = useState<'location' | 'manual'>('location')
  const [manualInput, setManualInput]             = useState('')
  const [manualError, setManualError]             = useState('')
  const [projections, setProjections]             = useState<Projection[]>([])
  const [projectionsLoading, setProjectionsLoading] = useState(false)
  const [projectionsError, setProjectionsError]   = useState<string | null>(null)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const miniMapContainerRef = useRef<HTMLDivElement>(null)
  const miniMapRef          = useRef<maplibregl.Map | null>(null)
  const markerRef           = useRef<maplibregl.Marker | null>(null)

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // ── Auto-expand when CRS is unknown ───────────────────────────────────────
  useEffect(() => {
    if (geoInfo && !geoInfo.isWGS84 && geoInfo.epsg === null) {
      setIsExpanded(true)
    }
  }, [geoInfo])

  // ── Fetch projection suggestions from projest.io ──────────────────────────
  const fetchProjections = useCallback(async (lng: number, lat: number) => {
    setProjectionsLoading(true)
    setProjectionsError(null)
    setProjections([])

    try {
      const geom = JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {},
      })
      const url = `${API_URL}?geom=${encodeURIComponent(geom)}&max=12&sort=areadiff`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`API returned ${res.status}`)

      const data = await res.json() as Array<{
        coord_ref_sys_code: number
        coord_ref_sys_name: string
        area_name:          string
        unit_of_meas_name:  string
      }>

      if (!Array.isArray(data)) throw new Error('Unexpected API response format')

      setProjections(
        data.map((p) => ({
          code:     p.coord_ref_sys_code,
          name:     p.coord_ref_sys_name,
          areaName: p.area_name,
          units:    p.unit_of_meas_name,
        }))
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const isCors = msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
      setProjectionsError(
        isCors
          ? 'Could not reach projest.io (possible CORS restriction). Use the "Enter EPSG code" tab instead.'
          : `Failed to load suggestions: ${msg}`
      )
    } finally {
      setProjectionsLoading(false)
    }
  }, [])

  // Keep a stable ref so the map click handler is never stale
  const fetchRef = useRef(fetchProjections)
  useEffect(() => { fetchRef.current = fetchProjections }, [fetchProjections])

  // ── Mini-map lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isExpanded || activeTab !== 'location' || !miniMapContainerRef.current) return

    const map = new maplibregl.Map({
      container:       miniMapContainerRef.current,
      style:           isDark ? DARK_STYLE : LIGHT_STYLE,
      center:          [0, 20],
      zoom:            1,
      pitchWithRotate: false,
      dragRotate:      false,
      attributionControl: false,
    })

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    miniMapRef.current = map

    map.on('click', (e) => {
      const { lng, lat } = e.lngLat

      // Place or move the marker
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat])
      } else {
        markerRef.current = new maplibregl.Marker({ color: '#6366f1' })
          .setLngLat([lng, lat])
          .addTo(map)
      }

      fetchRef.current(lng, lat)
    })

    map.getCanvas().style.cursor = 'crosshair'

    return () => {
      map.remove()
      miniMapRef.current = null
      markerRef.current  = null
      setProjections([])
      setProjectionsLoading(false)
      setProjectionsError(null)
    }
  // Re-run when the drawer opens/closes, tab changes, or theme switches
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, activeTab, isDark])

  // ── Manual EPSG apply ─────────────────────────────────────────────────────
  function applyManual(e: React.FormEvent) {
    e.preventDefault()
    const cleaned = manualInput.trim().replace(/^EPSG:/i, '')
    const n = parseInt(cleaned, 10)
    if (!Number.isFinite(n) || n <= 0 || n > 999999) {
      setManualError('Enter a valid EPSG code, e.g. 26912')
      return
    }
    setGeoEpsg(n)
    setIsExpanded(false)
    setManualInput('')
    setManualError('')
  }

  function applyProjection(code: number) {
    setGeoEpsg(code)
    setIsExpanded(false)
  }

  // ── Visibility guard (after all hooks) ───────────────────────────────────
  if (!geoInfo || geoInfo.isWGS84) return null

  const hasEpsg = geoInfo.epsg !== null

  // ── Collapsed strip ───────────────────────────────────────────────────────
  if (!isExpanded && hasEpsg) {
    return (
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 text-xs">
        <WarningIcon className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
        <span className="text-amber-700 dark:text-amber-300">
          Non-WGS84 projection detected. Reprojecting from{' '}
          <span className="font-mono font-semibold">EPSG:{geoInfo.epsg}</span> → WGS 84.
        </span>
        <button
          onClick={() => setIsExpanded(true)}
          className="ml-auto shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 hover:underline transition-colors"
        >
          Change
        </button>
      </div>
    )
  }

  // ── Expanded drawer ───────────────────────────────────────────────────────
  return (
    <div className="shrink-0 border-b border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/30">

      {/* Header row */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
        <WarningIcon className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {hasEpsg
            ? `Source CRS: EPSG:${geoInfo.epsg} — change projection`
            : 'Non-WGS84 projection detected — set the source CRS to render features on the map'}
        </span>
        {/* Close only available once an EPSG has been chosen */}
        {hasEpsg && (
          <button
            onClick={() => setIsExpanded(false)}
            aria-label="Close CRS panel"
            className="ml-auto shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
          >
            <svg viewBox="0 0 14 14" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 px-3 pb-0">
        {(['location', 'manual'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 text-xs font-medium rounded-t border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-amber-500 dark:border-amber-400 text-amber-800 dark:text-amber-200 bg-white/60 dark:bg-gray-900/40'
                : 'border-transparent text-amber-600 dark:text-amber-500 hover:text-amber-800 dark:hover:text-amber-200'
            }`}
          >
            {tab === 'location' ? 'Find by location' : 'Enter EPSG code'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-3 py-2.5">

        {/* ── Location tab ─────────────────────────────────────────────── */}
        {activeTab === 'location' && (
          <div className="flex gap-3">

            {/* Mini-map */}
            <div className="shrink-0 w-56 flex flex-col gap-1">
              <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                Click anywhere the data should appear to get projection suggestions.
              </p>
              <div
                ref={miniMapContainerRef}
                className="rounded overflow-hidden border border-amber-200 dark:border-amber-800"
                style={{ height: 180 }}
              />
            </div>

            {/* Suggestions */}
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              {!projectionsLoading && !projectionsError && projections.length === 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500 italic mt-6">
                  Click the map to load suggestions for that area.
                </p>
              )}

              {projectionsLoading && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-6">
                  Loading suggestions…
                </p>
              )}

              {projectionsError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-2 leading-snug">
                  {projectionsError}
                </p>
              )}

              {projections.length > 0 && (
                <>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mb-0.5">
                    Select a projection to apply:
                  </p>
                  <div className="overflow-y-auto flex flex-col gap-0.5" style={{ maxHeight: 165 }}>
                    {projections.map((p) => (
                      <button
                        key={p.code}
                        onClick={() => applyProjection(p.code)}
                        className="text-left px-2 py-1.5 rounded text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors group"
                      >
                        <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300 group-hover:text-indigo-900 dark:group-hover:text-indigo-100">
                          EPSG:{p.code}
                        </span>
                        <span className="ml-2 text-gray-700 dark:text-gray-300 truncate">
                          {p.name}
                        </span>
                        <span className="ml-1.5 text-gray-400 dark:text-gray-500 text-[10px]">
                          ({p.units})
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Manual EPSG tab ──────────────────────────────────────────── */}
        {activeTab === 'manual' && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
              Enter the EPSG code for the source projection.{' '}
              <span className="opacity-70">e.g. NAD83 / UTM Zone 12N is 26912</span>
            </p>
            <form onSubmit={applyManual} className="flex items-start gap-2">
              <div className="flex flex-col gap-1">
                <input
                  autoFocus
                  value={manualInput}
                  onChange={(e) => { setManualInput(e.target.value); setManualError('') }}
                  placeholder="e.g. 26912"
                  className="w-36 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {manualError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400">{manualError}</p>
                )}
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition-colors"
              >
                Apply
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Icon helper ───────────────────────────────────────────────────────────────

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  )
}
