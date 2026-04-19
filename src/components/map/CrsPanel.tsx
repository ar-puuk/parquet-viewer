import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useAppStore } from '../../store/useAppStore'

interface Projection {
  code: number
  name: string
  units: string
}

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const DARK_STYLE  = 'https://tiles.openfreemap.org/styles/dark'

const proj4Cache = new Map<number, string>()

async function fetchProj4Def(epsg: number): Promise<string | null> {
  if (proj4Cache.has(epsg)) return proj4Cache.get(epsg)!
  try {
    const res  = await fetch(`https://epsg.io/${epsg}.proj4`)
    if (!res.ok) return null
    const text = await res.text()
    if (!text.trim().startsWith('+')) return null
    proj4Cache.set(epsg, text.trim())
    return text.trim()
  } catch {
    return null
  }
}

export function CrsPanel() {
  const geoInfo    = useAppStore((s) => s.geoInfo)
  const setGeoEpsg = useAppStore((s) => s.setGeoEpsg)
  const theme      = useAppStore((s) => s.theme)

  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab]   = useState<'location' | 'manual'>('location')

  const [projections, setProjections]       = useState<Projection[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError]     = useState<string | null>(null)

  const [manualInput, setManualInput] = useState('')
  const [manualError, setManualError] = useState('')

  const [applying, setApplying]     = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const miniMapContainerRef = useRef<HTMLDivElement>(null)
  const miniMapRef          = useRef<maplibregl.Map | null>(null)
  const markerRef           = useRef<maplibregl.Marker | null>(null)

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    if (geoInfo && !geoInfo.isWGS84 && geoInfo.epsg === null) {
      setIsExpanded(true)
    }
  }, [geoInfo])

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
    } catch {
      setSuggestError('Could not reach projest.io. Use the "Enter EPSG code" tab instead.')
    } finally {
      setSuggestLoading(false)
    }
  }, [])

  const fetchSuggestionsRef = useRef(fetchSuggestions)
  useEffect(() => { fetchSuggestionsRef.current = fetchSuggestions }, [fetchSuggestions])

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
        markerRef.current = new maplibregl.Marker({ color: '#b45309' })
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

  if (!geoInfo || geoInfo.isWGS84) return null

  const hasEpsg = geoInfo.epsg !== null

  // ── Collapsed strip ───────────────────────────────────────────────────────
  if (!isExpanded && hasEpsg) {
    return (
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60">
        <WarningIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="text-amber-800 dark:text-amber-200">
          Non-WGS84 detected — reprojecting from{' '}
          <span className="font-mono font-semibold">EPSG:{geoInfo.epsg}</span> to WGS 84
        </span>
        <button
          onClick={() => setIsExpanded(true)}
          className="ml-auto shrink-0 text-amber-600 dark:text-amber-400 hover:underline text-xs font-medium"
        >
          Change
        </button>
      </div>
    )
  }

  // ── Expanded drawer ───────────────────────────────────────────────────────
  return (
    <div className="shrink-0 border-b border-amber-200 dark:border-amber-800/60 bg-white dark:bg-[#131e28]">

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
            className="ml-auto shrink-0 p-0.5 rounded text-[#a8977a] dark:text-[#485868] hover:text-[#6b5e4a] dark:hover:text-[#8a98a8]"
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#d4c5a9] dark:border-[#253545] px-3">
        {(['location', 'manual'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-[#b45309] dark:border-[#fbbf24] text-[#b45309] dark:text-[#fbbf24]'
                : 'border-transparent text-[#6b5e4a] dark:text-[#8a98a8] hover:text-[#1c1208] dark:hover:text-[#f0ebe0]'
            }`}
          >
            {tab === 'location' ? 'Find by location' : 'Enter EPSG code'}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="p-3">

        {applyError && (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{applyError}</p>
        )}

        {/* ── Location tab ─────────────────────────────────────────────── */}
        {activeTab === 'location' && (
          <div className="flex gap-3">
            <div className="shrink-0 w-52 flex flex-col gap-1">
              <p className="text-[11px] text-[#6b5e4a] dark:text-[#8a98a8]">
                Click where your data is located:
              </p>
              <div
                ref={miniMapContainerRef}
                className="w-full rounded-lg border border-[#d4c5a9] dark:border-[#253545] overflow-hidden shadow-sm"
                style={{ height: 164 }}
              />
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-1">
              {!suggestLoading && !suggestError && projections.length === 0 && (
                <p className="text-[11px] text-[#a8977a] dark:text-[#485868] mt-8 italic">
                  Click the map to see suggestions for that area.
                </p>
              )}
              {suggestLoading && (
                <p className="text-[11px] text-[#6b5e4a] dark:text-[#8a98a8] mt-8">Loading…</p>
              )}
              {suggestError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">{suggestError}</p>
              )}
              {projections.length > 0 && (
                <div className="overflow-y-auto" style={{ maxHeight: 172 }}>
                  <p className="text-[11px] text-[#6b5e4a] dark:text-[#8a98a8] mb-1">
                    Select a projection:
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {projections.map((p) => (
                      <button
                        key={p.code}
                        disabled={applying}
                        onClick={() => applyEpsg(p.code)}
                        className="text-left px-2 py-1 rounded text-xs border border-transparent hover:bg-[#fef3c7] dark:hover:bg-[#2d1c04] hover:border-[#e8dfc8] dark:hover:border-[#b45309]/40 transition-colors disabled:opacity-50"
                      >
                        <span className="font-mono font-semibold text-[#b45309] dark:text-[#fbbf24]">
                          EPSG:{p.code}
                        </span>
                        <span className="ml-2 text-[#1c1208] dark:text-[#f0ebe0]">{p.name}</span>
                        <span className="ml-1 text-[#a8977a] dark:text-[#485868] text-[10px]">({p.units})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {applying && (
                <p className="text-[11px] text-[#b45309] dark:text-[#fbbf24] mt-1">
                  Loading projection definition…
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Manual tab ───────────────────────────────────────────────── */}
        {activeTab === 'manual' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[#6b5e4a] dark:text-[#8a98a8]">
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
                  className="w-32 px-2 py-1.5 border border-[#d4c5a9] dark:border-[#253545] rounded text-sm bg-white dark:bg-[#192430] text-[#1c1208] dark:text-[#f0ebe0] placeholder-[#a8977a] dark:placeholder-[#485868] focus:outline-none focus:ring-1 focus:ring-[#b45309] dark:focus:ring-[#fbbf24] disabled:opacity-50"
                />
                {manualError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400">{manualError}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={applying}
                className="px-3 py-1.5 bg-[#b45309] hover:bg-[#92400e] dark:bg-[#fbbf24] dark:hover:bg-[#f59e0b] disabled:opacity-50 text-white dark:text-[#1c1208] rounded text-sm font-medium transition-colors duration-150"
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
