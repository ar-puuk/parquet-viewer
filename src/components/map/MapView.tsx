import { useEffect, useRef, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useAppStore } from '../../store/useAppStore'
import type { GeoFeature } from '../../hooks/useGeoData'

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'

const SOURCE_ID = 'geo-data'
const LAYER_CIRCLE = 'geo-circle'
const LAYER_LINE = 'geo-line'
const LAYER_FILL = 'geo-fill'
const LAYER_FILL_OUTLINE = 'geo-fill-outline'
const INTERACTIVE_LAYERS = [LAYER_CIRCLE, LAYER_LINE, LAYER_FILL]

interface Props {
  features: GeoFeature[]
  fitKey?: number | string
  onFeatureClick?: (rowId: number) => void
}

export function MapView({ features, fitKey, onFeatureClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const layersAddedRef = useRef(false)
  const prevHoveredRef = useRef<number | null>(null)

  const theme = useAppStore((s) => s.theme)
  const hoveredRowId = useAppStore((s) => s.hoveredRowId)
  const setHoveredRowId = useAppStore((s) => s.setHoveredRowId)

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // ── Build GeoJSON once per features snapshot (not on every re-render) ─────
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: features.flatMap((f) => {
      try {
        const geometry = JSON.parse(f.geojson) as GeoJSON.Geometry
        return [{
          type: 'Feature' as const,
          id: f.__row_id,
          geometry,
          properties: { ...f.properties, __row_id: f.__row_id },
        }]
      } catch {
        return []
      }
    }),
  }), [features])

  // ── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isDark ? DARK_STYLE : LIGHT_STYLE,
      center: [0, 20],
      zoom: 1,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map
    layersAddedRef.current = false

    return () => {
      map.remove()
      mapRef.current = null
      layersAddedRef.current = false
    }
  // Run only once — isDark changes handled by separate effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Theme: swap style ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersAddedRef.current = false // layers are wiped when style changes
    map.setStyle(isDark ? DARK_STYLE : LIGHT_STYLE)
  }, [isDark])

  // ── Add layers once after style loads; re-add after style swap ───────────
  function addLayers(map: maplibregl.Map) {
    if (map.getLayer(LAYER_CIRCLE)) return // already added

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: '__row_id',
    })

    map.addLayer({
      id: LAYER_CIRCLE,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 8, 5],
        'circle-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#6366f1', '#3b82f6'],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff',
      },
    })

    map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#6366f1', '#3b82f6'],
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 2],
        'line-opacity': 0.9,
      },
    })

    map.addLayer({
      id: LAYER_FILL,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: {
        'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#6366f1', '#3b82f6'],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.5, 0.3],
      },
    })

    map.addLayer({
      id: LAYER_FILL_OUTLINE,
      type: 'line',
      source: SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'line-color': '#2563eb', 'line-width': 1, 'line-opacity': 0.8 },
    })

    INTERACTIVE_LAYERS.forEach((layerId) => {
      map.on('mousemove', layerId, (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const rowId = e.features?.[0]?.id != null ? Number(e.features[0].id) : null
        setHoveredRowId(rowId)
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
        setHoveredRowId(null)
      })
    })

    layersAddedRef.current = true
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const init = () => addLayers(map)
    if (map.isStyleLoaded()) {
      init()
    } else {
      map.once('style.load', init)
    }
  // setHoveredRowId is stable; re-run whenever map is ready or style swaps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  // ── Push GeoJSON data to source whenever it changes ──────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let rafId: number

    function pushData() {
      // Defer inside rAF so MapLibre's setData doesn't force a synchronous
      // layout recalculation (forced reflow) during a JS task.
      rafId = requestAnimationFrame(() => {
        const src = mapRef.current?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
        if (src) src.setData(geojson)
      })
    }

    if (map.isStyleLoaded() && layersAddedRef.current) {
      pushData()
    } else {
      map.once('style.load', () => setTimeout(pushData, 0))
    }

    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [geojson])

  // ── Fit bounds on first load and whenever fitKey changes (page turn) ────
  const prevFitKeyRef = useRef<number | string | undefined>(undefined)
  useEffect(() => {
    if (features.length === 0) return
    if (prevFitKeyRef.current === fitKey && fitKey !== undefined) return
    prevFitKeyRef.current = fitKey
    const map = mapRef.current
    if (!map) return
    try {
      const bounds = new maplibregl.LngLatBounds()
      for (const f of features) {
        collectCoords(JSON.parse(f.geojson) as GeoJSON.Geometry, bounds)
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 800 })
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, fitKey])

  // ── Hover feature-state ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource(SOURCE_ID)) return
    if (prevHoveredRef.current != null) {
      map.setFeatureState({ source: SOURCE_ID, id: prevHoveredRef.current }, { hover: false })
    }
    if (hoveredRowId != null) {
      map.setFeatureState({ source: SOURCE_ID, id: hoveredRowId }, { hover: true })
    }
    prevHoveredRef.current = hoveredRowId
  }, [hoveredRowId])

  // ── Click handler ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    function handleClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
      const feat = e.features?.[0]
      if (!feat) return
      const rowId = feat.id != null ? Number(feat.id) : null
      if (rowId == null) return
      onFeatureClick?.(rowId)
      if (popupRef.current) popupRef.current.remove()
      const currentMap = mapRef.current
      if (!currentMap) return
      popupRef.current = new maplibregl.Popup({ maxWidth: '320px' })
        .setLngLat(e.lngLat)
        .setHTML(buildPopupHtml(feat.properties ?? {}))
        .addTo(currentMap)
    }

    INTERACTIVE_LAYERS.forEach((l) => map.on('click', l, handleClick))
    return () => { INTERACTIVE_LAYERS.forEach((l) => map.off('click', l, handleClick)) }
  }, [onFeatureClick])

  // ── ResizeObserver ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    const map = mapRef.current
    if (!el || !map) return
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return <div ref={containerRef} className="w-full h-full" />
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function collectCoords(geom: GeoJSON.Geometry, bounds: maplibregl.LngLatBounds) {
  switch (geom.type) {
    case 'Point':
      bounds.extend(geom.coordinates as [number, number]); break
    case 'MultiPoint': case 'LineString':
      for (const c of geom.coordinates) bounds.extend(c as [number, number]); break
    case 'MultiLineString': case 'Polygon':
      for (const ring of geom.coordinates)
        for (const c of ring) bounds.extend(c as [number, number]); break
    case 'MultiPolygon':
      for (const poly of geom.coordinates)
        for (const ring of poly)
          for (const c of ring) bounds.extend(c as [number, number]); break
    case 'GeometryCollection':
      for (const g of geom.geometries) collectCoords(g, bounds); break
  }
}

function buildPopupHtml(props: Record<string, unknown>): string {
  const rows = Object.entries(props)
    .filter(([k]) => k !== '__row_id')
    .map(([k, v]) => {
      const display = v == null
        ? '<span style="opacity:0.4">null</span>'
        : escapeHtml(String(v))
      return `<tr>
        <td style="padding:2px 6px 2px 0;font-weight:500;white-space:nowrap;opacity:0.7">${escapeHtml(k)}</td>
        <td style="padding:2px 0;word-break:break-all">${display}</td>
      </tr>`
    })
    .join('')
  return `<div style="max-height:240px;overflow-y:auto;font-size:12px;font-family:monospace"><table>${rows}</table></div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
