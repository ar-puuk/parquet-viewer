import { useEffect, useRef, useCallback } from 'react'
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

interface Props {
  features: GeoFeature[]
  onFeatureClick?: (rowId: number) => void
}

export function MapView({ features, onFeatureClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const theme = useAppStore((s) => s.theme)
  const hoveredRowId = useAppStore((s) => s.hoveredRowId)
  const setHoveredRowId = useAppStore((s) => s.setHoveredRowId)
  const prevHoveredRef = useRef<number | null>(null)

  // Determine effective dark mode
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

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

    return () => {
      map.remove()
      mapRef.current = null
    }
  // Run only once — theme changes handled separately
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Theme changes ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(isDark ? DARK_STYLE : LIGHT_STYLE)
  }, [isDark])

  // ── Build GeoJSON and add/update source + layers ─────────────────────────
  const updateSource = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: features
        .map((f) => {
          try {
            const geometry = JSON.parse(f.geojson) as GeoJSON.Geometry
            return {
              type: 'Feature' as const,
              id: f.__row_id,
              geometry,
              properties: { ...f.properties, __row_id: f.__row_id },
            }
          } catch {
            return null
          }
        })
        .filter(Boolean) as GeoJSON.Feature[],
    }

    const existing = map.getSource(SOURCE_ID)
    if (existing) {
      ;(existing as maplibregl.GeoJSONSource).setData(geojson)
      return
    }

    map.addSource(SOURCE_ID, { type: 'geojson', data: geojson, promoteId: '__row_id' })

    // Circle layer for points
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

    // Line layer
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

    // Fill layer for polygons
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

    // Fill outline
    map.addLayer({
      id: LAYER_FILL_OUTLINE,
      type: 'line',
      source: SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: {
        'line-color': '#2563eb',
        'line-width': 1,
        'line-opacity': 0.8,
      },
    })

    // Hover interaction
    const interactiveLayers = [LAYER_CIRCLE, LAYER_LINE, LAYER_FILL]
    interactiveLayers.forEach((layerId) => {
      map.on('mousemove', layerId, (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const feat = e.features?.[0]
        const rowId = feat?.id != null ? Number(feat.id) : null
        setHoveredRowId(rowId)
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
        setHoveredRowId(null)
      })
    })
  }, [features, setHoveredRowId])

  // Re-run updateSource when features change or style reloads
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) {
      updateSource()
    } else {
      map.once('style.load', updateSource)
    }
  }, [features, updateSource])

  // Also re-run after theme (style) change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = () => updateSource()
    map.on('style.load', handler)
    return () => { map.off('style.load', handler) }
  }, [updateSource])

  // ── Fit bounds when features first arrive ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || features.length === 0) return
    try {
      const bounds = new maplibregl.LngLatBounds()
      for (const f of features) {
        const geom = JSON.parse(f.geojson) as GeoJSON.Geometry
        collectCoords(geom, bounds)
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 800 })
      }
    } catch {
      // ignore parse errors
    }
  // Only fit on first load (when features go from 0 → non-empty)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features.length > 0])

  // ── Feature state: hover ─────────────────────────────────────────────────
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

  // ── Click to select ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const interactiveLayers = [LAYER_CIRCLE, LAYER_LINE, LAYER_FILL]

    function handleClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
      const feat = e.features?.[0]
      if (!feat) return
      const rowId = feat.id != null ? Number(feat.id) : null
      if (rowId == null) return
      onFeatureClick?.(rowId)

      // Show popup
      const coords = e.lngLat
      const props = feat.properties ?? {}
      const html = buildPopupHtml(props)
      if (popupRef.current) popupRef.current.remove()
      const currentMap = mapRef.current
      if (!currentMap) return
      popupRef.current = new maplibregl.Popup({ maxWidth: '320px' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(currentMap)
    }

    interactiveLayers.forEach((layerId) => {
      map.on('click', layerId, handleClick)
    })
    return () => {
      interactiveLayers.forEach((layerId) => {
        map.off('click', layerId, handleClick)
      })
    }
  }, [onFeatureClick])

  // ── ResizeObserver → map.resize() ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const map = mapRef.current
    if (!container || !map) return
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  return <div ref={containerRef} className="w-full h-full" />
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function collectCoords(geom: GeoJSON.Geometry, bounds: maplibregl.LngLatBounds) {
  switch (geom.type) {
    case 'Point':
      bounds.extend(geom.coordinates as [number, number])
      break
    case 'MultiPoint':
    case 'LineString':
      for (const c of geom.coordinates) bounds.extend(c as [number, number])
      break
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geom.coordinates)
        for (const c of ring) bounds.extend(c as [number, number])
      break
    case 'MultiPolygon':
      for (const poly of geom.coordinates)
        for (const ring of poly)
          for (const c of ring) bounds.extend(c as [number, number])
      break
    case 'GeometryCollection':
      for (const g of geom.geometries) collectCoords(g, bounds)
      break
  }
}

function buildPopupHtml(props: Record<string, unknown>): string {
  const rows = Object.entries(props)
    .filter(([k]) => k !== '__row_id')
    .map(([k, v]) => {
      const display = v == null ? '<span style="opacity:0.4">null</span>' : escapeHtml(String(v))
      return `<tr><td style="padding:2px 6px 2px 0;font-weight:500;white-space:nowrap;opacity:0.7">${escapeHtml(k)}</td><td style="padding:2px 0;word-break:break-all">${display}</td></tr>`
    })
    .join('')
  return `<div style="max-height:240px;overflow-y:auto;font-size:12px;font-family:monospace"><table>${rows}</table></div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
