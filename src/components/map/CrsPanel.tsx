import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useAppStore } from '../../store/useAppStore'

// ── Types ────────────────────────────────────────────────────────────────────

interface Projection {
  code: number
  name: string
  units: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const DARK_STYLE  = 'https://tiles.openfreemap.org/styles/dark'

// ── proj4 string fetcher ─────────────────────────────────────────────────────

// Session-level cache so we never hit epsg.io twice for the same code
const proj4Cache = new Map<number, string>()

async function fetchProj4Def(epsg: number): Promise<string | null> {
  if (proj4Cache.has(epsg)) return proj4Cache.get(epsg)!
  try {
    const res  = await fetch(`https://epsg.io/${epsg}.proj4`)
    if (!res.ok) return null
    const text = await res.text()
    // A valid proj4 string starts with '+' (e.g. +proj=utm +zone=12 …)
    if (!text.trim().startsWith('+')) return null
    proj4Cache.set(epsg, text.trim())
    return text.trim()
  } catch {
    return null
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function CrsPanel() {
  const geoInfo    = useAppStore((s) => s.geoInfo)
  const setGeoEpsg = useAppStore((s) => s.setGeoEpsg)
  const theme      = useAppStore((s) => s.theme)

  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab]   = useState<'location' | 'manual'>('location')

  // Location tab state
  const [projections, setProjections]           = useState<Projection[]>([])
  const [suggestLoading, setSuggestLoading]     = useState(false)
  const [suggestError, setSuggestError]         = useState<string | null>(null)

  // Manual tab state
  const [manualInput, setManualInput] = useState('')
  const [manualError, setManualError] = useState('')

  // Shared applying state (loading proj4 def after selection)
  const [applying, setApplying]       = useState(false)
  const [applyError, setApplyError]   = useState<string | null>(null)

  const miniMapContainerRef = useRef<HTMLDivElement>(null)
  const miniMapRef          = useRef<maplibregl.Map | null>(null)
  const markerRef           = useRef<maplibregl.Marker | null>(null)

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Auto-expand when CRS is unknown and not yet set
  useEffect(() => {
    if (geoInfo && !geoInfo.isWGS84 && geoInfo.epsg === null) {
      setIsExpanded(true)
    }
  }, [geoInfo])

  // ── Apply an EPSG code (fetch proj4 def → update store) ───────────────────
  const applyEpsg = useCallback(async (epsg: number) => {
    setApplying(true)
    setApplyError(null)
    const def = await fetchProj4Def(epsg)
    if (!def) {
      setApplyError(`Could not load projection definition for EPSG:${epsg}. Check the code and try again.`)
      setApplying(false)
      return
    }
    setGeoEpsg(epsg, def)
    setIsExpanded(false)
    setApplying(false)
    setApplyError(null)
  }, [setGeoEpsg])

  // ── Fetch projest.io suggestions for a clicked map point ─────────────────
  const fetchSuggestions = useCallback(async (lng: number, lat: number) => {
    setSuggestLoading(true)
    setSuggestError(null)
    setProjections([])
    try {
      const geom = JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {},
      })
      const res = await fetch(
        `https://projest.io/ns/api/?geom=${encodeURIComponent(geom)}&max=12&sort=areadiff`
      )
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const data = await res.json() as Array<{
        coord_ref_sys_code: number
        coord_ref_sys_name: string
        unit_of_meas_name:  string
      }>
      if (!Array.isArray(data)) throw new Error('Unexpected response format')
      setProjections(data.map((p) => ({
        code:  p.coord_ref_sys_code,
        name:  p.coord_ref_sys_name,
        units: p.unit_of_meas_name,
      })))
    } catch (e) {
      setSuggestError(
        'Could not reach projest.io. Use the "Enter EPSG code" tab instead.'
      )
    } finally {
      setSuggestLoading(false)
    }
  }, [])

  // Stable ref so the map click handler never captures stale state
  const fetchSuggestionsRef = useRef(fetchSuggestions)
  useEffect(() => { fetchSuggestionsRef.current = fetchSuggestions }, [fetchSuggestions])

  // ── Mini-map lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isExpanded || activeTab !== 'location' || !miniMapContainerRef.current) return

    const map = new maplibregl.Map({
      container:          miniMapContainerRef.current,
      style:              isDark ? DARK_STYLE : LIGHT_STYLE,
      center:             [0, 20],
      zoom:               1,
      pitchWithRotate:    false,
      dragRotate:         false,
      attributionControl: false,
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    miniMapRef.current = map

    map.on('click', (e) => {
      const { lng, lat } = e.lngLat
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat])
      } else {
        markerRef.current = new maplibregl.Marker({ color: '#6366f1' })
          .setLngLat([lng, lat])
          .addTo(map)
      }
      fetchSuggestionsRef.current(lng, lat)
    })

    map.getCanvas().style.cursor = 'crosshair'

    return () => {
      map.remove()
      miniMapRef.current = null
      markerRef.current  = null
      setProjections([])
      setSuggestLoading(false)
      setSuggestError(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, activeTab, isDark])

  // ── Manual form submit ────────────────────────────────────────────────────
  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setManualError('')
    const cleaned = manualInput.trim().replace(/^EPSG:\s*/i, '')
    const n = parseInt(cleaned, 10)
    if (!Number.isFinite(n) || n <= 0 || n > 999999) {
      setManualError('Enter a valid EPSG code, e.g. 26912')
      return
    }
    applyEpsg(n)
  }

  // ── Visibility guard (must be after all hooks) ───────────────────────────
  if (!geoInfo || geoInfo.isWGS84) return null

  const hasEpsg = geoInfo.epsg !== null

  // ── Collapsed strip ───────────────────────────────────────────────────────
  if (!isExpanded && hasEpsg) {
    return (
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800">
        <WarningIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="text-amber-800 dark:text-amber-200">
          Non-WGS84 detected — reprojecting from{' '}
          <span className="font-mono font-semibold">EPSG:{geoInfo.epsg}</span> to WGS 84
        </span>
        <button
          onClick={() => setIsExpanded(true)}
          className="ml-auto shrink-0 text-amber-600 dark:text-amber-400 hover:underline"
        >
          Change
        </button>
      </div>
    )
  }

  // ── Expanded drawer ───────────────────────────────────────────────────────
  return (
    <div className="shrink-0 border-b border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-100 dark:border-amber-900/60">
        <WarningIcon className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
          Non-WGS84 projection detected — set the source CRS to render features
        </span>
        {hasEpsg && (
          <button
            onClick={() => setIsExpanded(false)}
            aria-label="Close"
            className="ml-auto shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 px-3">
        {(['location', 'manual'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'location' ? 'Find by location' : 'Enter EPSG code'}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="p-3">

        {/* apply error (shared) */}
        {applyError && (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{applyError}</p>
        )}

        {/* ── Location tab ─────────────────────────────────────────────── */}
        {activeTab === 'location' && (
          <div className="flex gap-3">

            {/* Left: mini-map */}
            <div className="shrink-0 w-52 flex flex-col gap-1">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Click where your data is located:
              </p>
              <div
                ref={miniMapContainerRef}
                className="w-full rounded border border-gray-200 dark:border-gray-700 overflow-hidden"
                style={{ height: 164 }}
              />
            </div>

            {/* Right: suggestions */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              {!suggestLoading && !suggestError && projections.length === 0 && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-8 italic">
                  Click the map to see suggestions for that area.
                </p>
              )}
              {suggestLoading && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-8">Loading…</p>
              )}
              {suggestError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">{suggestError}</p>
              )}
              {projections.length > 0 && (
                <div className="overflow-y-auto" style={{ maxHeight: 172 }}>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                    Select a projection:
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {projections.map((p) => (
                      <button
                        key={p.code}
                        disabled={applying}
                        onClick={() => applyEpsg(p.code)}
                        className="text-left px-2 py-1 rounded text-xs border border-transparent hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-950/50 dark:hover:border-indigo-800 transition-colors disabled:opacity-50"
                      >
                        <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                          EPSG:{p.code}
                        </span>
                        <span className="ml-2 text-gray-700 dark:text-gray-300">{p.name}</span>
                        <span className="ml-1 text-gray-400 text-[10px]">({p.units})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {applying && (
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1">
                  Loading projection definition…
                </p>
              )}
            </div>

          </div>
        )}

        {/* ── Manual tab ───────────────────────────────────────────────── */}
        {activeTab === 'manual' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Enter the EPSG code for the source projection.{' '}
              <span className="opacity-60">e.g. NAD83 / UTM Zone 12N → 26912</span>
            </p>
            <form onSubmit={handleManualSubmit} className="flex items-start gap-2">
              <div className="flex flex-col gap-1">
                <input
                  autoFocus
                  value={manualInput}
                  onChange={(e) => { setManualInput(e.target.value); setManualError(''); setApplyError(null) }}
                  placeholder="26912"
                  disabled={applying}
                  className="w-32 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                />
                {manualError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400">{manualError}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={applying}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
              >
                {applying ? 'Loading…' : 'Apply'}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Icon ──────────────────────────────────────────────────────────────────────

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
