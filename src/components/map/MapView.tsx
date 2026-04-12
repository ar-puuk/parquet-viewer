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
  /** Fit map to this bbox [minx, miny, maxx, maxy] on first mount (from metadata). */
  initialBbox?: [number, number, number, number] | null
  onFeatureClick?: (rowId: number) => void
}

export function MapView({ features, initialBbox, onFeatureClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const layersAddedRef = useRef(false)
  const prevHoveredRef = useRef<number | null>(null)

  const theme = useAppStore((s) => s.theme)
  const hoveredRowId = useAppStore((s) => s.hoveredRowId)
  const selectedRowId = useAppStore((s) => s.selectedRowId)
  const setHoveredRowId = useAppStore((s) => s.setHoveredRowId)

  const prevSelectedRef = useRef<number | null>(null)
  // Skip the isDark effect on mount — map is already initialised with the
  // correct style; calling setStyle again immediately cancels the first load
  // and races with the addLayers effect's style.load listener.
  const themeInitRef = useRef(false)
  // Stable ref so fly-to effect can read current features without being a dep
  const featuresRef = useRef(features)
  featuresRef.current = features

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // ── Build GeoJSON once per features snapshot (not on every re-render) ─────
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: features.flatMap((f) => {
      try {
        const geometry = JSON.parse(f.geojson) as GeoJSON.Geometry
        // Explode GeometryCollection into individual features so each sub-geometry
        // is matched by one of the typed layer filters (circle / line / fill).
        if (geometry.type === 'GeometryCollection') {
          return geometry.geometries.map((g) => ({
            type: 'Feature' as const,
            id: f.__row_id,
            geometry: g,
            properties: { ...f.properties, __row_id: f.__row_id },
          }))
        }
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

  // Stable ref so addLayers callback can push current data after a style swap
  const geojsonRef = useRef(geojson)
  geojsonRef.current = geojson

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
    // Skip on mount: the map was already created with the correct style above.
    // Calling setStyle immediately would cancel the first style load and race
    // with the addLayers effect's once('style.load') listener.
    if (!themeInitRef.current) { themeInitRef.current = true; return }
    const map = mapRef.current
    if (!map) return
    console.log('[map-debug] isDark effect SWAP | isDark:', isDark)
    layersAddedRef.current = false // layers are wiped when style changes
    map.setStyle(isDark ? DARK_STYLE : LIGHT_STYLE)
  }, [isDark])

  // ── Add layers once after style loads; re-add after style swap ───────────
  function addLayers(map: maplibregl.Map) {
    console.log('[map-debug] addLayers | circleExists:', !!map.getLayer(LAYER_CIRCLE), '| srcExists:', !!map.getSource(SOURCE_ID))
    if (map.getLayer(LAYER_CIRCLE)) return // already added

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: '__row_id',
    })
    console.log('[map-debug] addLayers: source added ok:', !!map.getSource(SOURCE_ID))

    map.addLayer({
      id: LAYER_CIRCLE,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
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
    const init = () => {
      addLayers(map)
      // After layers are (re-)added, re-push current data so the source isn't
      // left empty — this is critical after a style swap (theme change) because
      // the pushData effect won't re-run when geojson hasn't changed.
      requestAnimationFrame(() => {
        const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
        console.log('[map-debug] addLayers effect rAF | src:', !!src)
        if (src) src.setData(geojsonRef.current)
      })
    }
    if (map.isStyleLoaded()) {
      console.log('[map-debug] addLayers effect: style already loaded, calling init')
      init()
    } else {
      console.log('[map-debug] addLayers effect: waiting for style.load')
      map.once('style.load', () => { console.log('[map-debug] style.load fired'); init() })
    }
  // setHoveredRowId is stable; re-run whenever map is ready or style swaps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  // ── Push GeoJSON data to source whenever it changes ──────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const mapNN = map!  // non-null alias for use inside rAF closures where TS loses narrowing
    let rafId: number

    function pushData() {
      // Defer inside rAF so MapLibre's setData doesn't force a synchronous
      // layout recalculation (forced reflow) during a JS task.
      // Use the locally-captured 'map' (not mapRef.current) so we always query
      // the same instance the effect was initialised with — mapRef.current can
      // theoretically be null if the component unmounts between scheduling the
      // rAF and its execution, even though the cleanup cancels the rAF.
      rafId = requestAnimationFrame(() => {
        const src = mapNN.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
        console.log('[map-debug] pushData rAF | src:', !!src, '| features:', geojson.features.length, '| first geom:', geojson.features[0]?.geometry?.type, geojson.features[0]?.geometry?.type === 'Polygon' ? (geojson.features[0].geometry as GeoJSON.Polygon).coordinates[0][0] : '')
        if (src) src.setData(geojson)
      })
    }

    if (map.isStyleLoaded()) {
      // Ensure layers exist — addLayers is idempotent so calling it here is safe
      // when there's a race between this effect and the addLayers effect.
      if (!layersAddedRef.current) addLayers(map)
      console.log('[map-debug] pushData called | styleLoaded:true | layersAdded:', layersAddedRef.current)
      pushData()
    } else {
      map.once('style.load', () => setTimeout(pushData, 0))
    }

    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [geojson])

  // ── Fit bounds: metadata bbox on mount, then features when first loaded ──
  const hasFitRef = useRef(false)

  // 1. If we have a metadata bbox, fit immediately when map is ready
  useEffect(() => {
    if (!initialBbox || hasFitRef.current) return
    const map = mapRef.current
    if (!map) return
    const fit = () => {
      hasFitRef.current = true
      const [minx, miny, maxx, maxy] = initialBbox
      map.fitBounds([[minx, miny], [maxx, maxy]], { padding: 40, maxZoom: 14, duration: 600 })
    }
    if (map.isStyleLoaded()) fit()
    else map.once('style.load', fit)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBbox])

  // 2. When features first arrive (after query), fit to their actual bounds
  //    (more precise than the metadata bbox, and handles the no-bbox case)
  useEffect(() => {
    if (features.length === 0) return
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
  // Only refit when the feature set identity changes (new query result)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features])

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

  // ── Selected feature-state ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource(SOURCE_ID)) return
    if (prevSelectedRef.current != null) {
      map.setFeatureState({ source: SOURCE_ID, id: prevSelectedRef.current }, { selected: false })
    }
    if (selectedRowId != null) {
      map.setFeatureState({ source: SOURCE_ID, id: selectedRowId }, { selected: true })
    }
    prevSelectedRef.current = selectedRowId
  }, [selectedRowId])

  // ── Fly to + popup when selectedRowId changes ────────────────────────────
  useEffect(() => {
    if (selectedRowId == null) return
    const map = mapRef.current
    if (!map) return
    const feat = featuresRef.current.find((f) => f.__row_id === selectedRowId)
    if (!feat) return
    try {
      const geom = JSON.parse(feat.geojson) as GeoJSON.Geometry
      const center = getCenter(geom)
      if (!center) return
      map.flyTo({ center, zoom: Math.max(map.getZoom(), 12), duration: 600 })
      if (popupRef.current) popupRef.current.remove()
      popupRef.current = new maplibregl.Popup({ maxWidth: '320px' })
        .setLngLat(center)
        .setHTML(buildPopupHtml(feat.properties))
        .addTo(map)
    } catch { /* ignore malformed geometry */ }
  }, [selectedRowId])

  // ── Click handler: just set selectedRowId (effect above handles popup) ───
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    function handleClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
      const feat = e.features?.[0]
      if (!feat) return
      const rowId = feat.id != null ? Number(feat.id) : null
      if (rowId == null) return
      onFeatureClick?.(rowId)
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

function getCenter(geom: GeoJSON.Geometry): [number, number] | null {
  switch (geom.type) {
    case 'Point':
      return geom.coordinates as [number, number]
    case 'MultiPoint':
    case 'LineString': {
      const coords = geom.coordinates as [number, number][]
      return coords[Math.floor(coords.length / 2)] ?? null
    }
    case 'MultiLineString':
    case 'Polygon': {
      const ring = geom.coordinates[0] as [number, number][]
      if (!ring?.length) return null
      return [
        ring.reduce((s, c) => s + c[0], 0) / ring.length,
        ring.reduce((s, c) => s + c[1], 0) / ring.length,
      ]
    }
    case 'MultiPolygon': {
      const ring = geom.coordinates[0]?.[0] as [number, number][] | undefined
      if (!ring?.length) return null
      return [
        ring.reduce((s, c) => s + c[0], 0) / ring.length,
        ring.reduce((s, c) => s + c[1], 0) / ring.length,
      ]
    }
    case 'GeometryCollection':
      return geom.geometries.length > 0 ? getCenter(geom.geometries[0]) : null
    default:
      return null
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
