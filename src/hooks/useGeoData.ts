import { useState, useEffect, useRef } from 'react'
import proj4 from 'proj4'
import { queryDB } from './useDuckDB'
import { useAppStore } from '../store/useAppStore'
import type { GeoInfo } from '../types'

export interface GeoFeature {
  __row_id: number
  geojson: string
  properties: Record<string, unknown>
}

export interface GeoDataResult {
  features: GeoFeature[]
  loading: boolean
  error: string | null
}

/**
 * Runs a companion geometry query whenever the queryResult changes.
 *
 * Strategy:
 *   1. Use the user's SQL as a subquery — include the geometry column so we
 *      can convert it, while keeping the same WHERE / ORDER / LIMIT.
 *   2. If the geometry column was excluded from the user's query, fall back to
 *      re-querying with the same LIMIT directly from `data`.
 *
 * Reprojection: ST_Transform in DuckDB WASM is unreliable (stripped PROJ DB).
 * Instead, when geoInfo.proj4String is set the raw coordinates are reprojected
 * client-side using proj4js after DuckDB returns the GeoJSON.
 */
export function useGeoData(geoInfo: GeoInfo | null): GeoDataResult {
  const queryResult = useAppStore((s) => s.queryResult)
  const schema      = useAppStore((s) => s.schema)

  const [features, setFeatures] = useState<GeoFeature[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const sessionRef = useRef(0)

  useEffect(() => {
    if (!geoInfo || !schema) {
      setFeatures([])
      return
    }

    if (!queryResult) {
      setFeatures([])
      return
    }

    const session = ++sessionRef.current
    setFeatures([])
    setLoading(true)
    setError(null)

    const geo = geoInfo

    // ── Build GeoJSON expression (no ST_Transform — reprojection done client-side) ──
    const col = `"${geo.geometryColumn}"`

    let geoExpr: string
    if (geo.encoding === 'native') {
      // DuckDB GEOMETRY type or a GeoArrow alias (POLYGON_2D etc.) that DuckDB
      // resolved to its native type after loading the spatial extension.
      geoExpr = `ST_AsGeoJSON(${col}::GEOMETRY)`
    } else if (geo.encoding === 'struct') {
      // Physical GeoArrow struct type (STRUCT(x DOUBLE, y DOUBLE)[][] etc.).
      // Select the raw column — DuckDB WASM returns it as a nested JS object
      // via Arrow. We convert the {x,y} coordinate objects to GeoJSON on the
      // client side. to_json() is avoided because the spatial extension may
      // override it to return null for unrecognised struct geometry types.
      geoExpr = col
    } else {
      const geomExpr = geo.encoding === 'wkt'
        ? `ST_GeomFromText(${col})`
        : `ST_GeomFromWKB(${col})`
      geoExpr = `ST_AsGeoJSON(${geomExpr})`
    }

    // Property columns: everything except the geometry column and __row_id
    const propCols = schema.filter(
      (c) =>
        c.name !== geo.geometryColumn &&
        c.name !== '__row_id' &&
        c.type.split('(')[0].toUpperCase().trim() !== 'BLOB'
    )
    const propSelect = propCols.map((c) => `"${c.name}"`).join(', ')

    const geoInResult = queryResult.columns.includes(geo.geometryColumn)
    const limit = queryResult.rows.length || 1000

    // Determine proj4 definition for client-side reprojection.
    // proj4String is set by CrsPanel when the user applies a CRS override.
    const proj4Def  = geo.proj4String ?? null
    const needsReproject = proj4Def !== null

    async function fetchFeatures() {
      try {
        let sql: string

        if (geoInResult) {
          sql = propSelect
            ? `SELECT (ROW_NUMBER() OVER () - 1) AS __row_id,
                      ${geoExpr} AS __geojson,
                      ${propSelect}
               FROM (${queryResult!.sql}) AS _q`
            : `SELECT (ROW_NUMBER() OVER () - 1) AS __row_id,
                      ${geoExpr} AS __geojson
               FROM (${queryResult!.sql}) AS _q`
        } else {
          const innerCols = [
            `"${geo.geometryColumn}"`,
            ...propCols.map((c) => `"${c.name}"`),
          ].join(', ')
          sql = propSelect
            ? `SELECT (ROW_NUMBER() OVER () - 1) AS __row_id,
                      ${geoExpr} AS __geojson,
                      ${propSelect}
               FROM (SELECT ${innerCols} FROM data LIMIT ${limit}) AS _page`
            : `SELECT (ROW_NUMBER() OVER () - 1) AS __row_id,
                      ${geoExpr} AS __geojson
               FROM (SELECT "${geo.geometryColumn}" FROM data LIMIT ${limit}) AS _page`
        }

        const rows = await queryDB(sql)
        if (session !== sessionRef.current) return

        await new Promise<void>((r) => setTimeout(r, 0))
        if (session !== sessionRef.current) return

        // Register proj4 definition once (idempotent)
        if (needsReproject && proj4Def) {
          proj4.defs(`EPSG:${geo.epsg}`, proj4Def)
        }

        const pageFeatures: GeoFeature[] = []
        for (const row of rows) {
          const raw = row['__geojson']
          let geojson: string

          if (geo.encoding === 'struct') {
            // raw is the Arrow representation of the GeoArrow struct column
            // (nested JS array/object). A JSON round-trip strips any Arrow
            // proxy wrappers and gives us plain {x, y} objects that
            // geoArrowToGeometry can consume.
            if (raw == null) { console.warn('[geo-debug] raw is null, skipping row'); continue }
            const structDepth = (geo.structType ?? '').match(/\[\]/g)?.length ?? 0
            console.log('[geo-debug] raw type:', typeof raw, '| constructor:', (raw as object)?.constructor?.name, '| depth:', structDepth, '| value:', raw)
            try {
              const serialised = JSON.stringify(raw)
              console.log('[geo-debug] JSON.stringify result:', serialised?.slice(0, 200))
              const structData = JSON.parse(serialised)
              const converted = geoArrowToGeometry(structData, structDepth)
              console.log('[geo-debug] converted geometry:', converted ? converted.type : 'null')
              if (!converted) continue
              geojson = JSON.stringify(converted)
            } catch (err) { console.error('[geo-debug] conversion error:', err); continue }
          } else {
            // ST_AsGeoJSON returns a GeoJSON string; DuckDB may also hand back
            // a pre-parsed object via Arrow — normalise either way.
            const asStr = raw == null ? '' :
              typeof raw === 'string' ? raw :
              typeof raw === 'object' ? JSON.stringify(raw) :
              String(raw)
            if (!asStr || asStr === 'null') continue
            geojson = asStr
          }

          // Client-side reprojection from source CRS → WGS84
          if (needsReproject && geo.epsg !== null) {
            try {
              const geom = JSON.parse(geojson) as Record<string, unknown>
              const reprojected = reprojectGeom(geom, `EPSG:${geo.epsg}`, 'WGS84')
              geojson = JSON.stringify(reprojected)
            } catch {
              // Malformed geometry — skip
              continue
            }
          }

          const properties: Record<string, unknown> = {}
          for (const col of propCols) {
            properties[col.name] = row[col.name]
          }
          pageFeatures.push({ __row_id: Number(row['__row_id']), geojson, properties })
        }

        setFeatures(pageFeatures)
      } catch (e) {
        if (session !== sessionRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (session === sessionRef.current) setLoading(false)
      }
    }

    fetchFeatures()
  }, [geoInfo, schema, queryResult])

  return { features, loading, error }
}

// ── Client-side reprojection ──────────────────────────────────────────────────

/**
 * Recursively reproject all coordinates in a GeoJSON geometry object
 * from `fromCrs` to WGS84 using proj4js.
 */
function reprojectGeom(
  geom: Record<string, unknown>,
  fromCrs: string,
  toCrs: string
): Record<string, unknown> {
  const rp = (c: number[]) => proj4(fromCrs, toCrs, c)

  switch (geom.type as string) {
    case 'Point':
      return { ...geom, coordinates: rp(geom.coordinates as number[]) }

    case 'MultiPoint':
    case 'LineString':
      return { ...geom, coordinates: (geom.coordinates as number[][]).map(rp) }

    case 'MultiLineString':
    case 'Polygon':
      return {
        ...geom,
        coordinates: (geom.coordinates as number[][][]).map((ring) => ring.map(rp)),
      }

    case 'MultiPolygon':
      return {
        ...geom,
        coordinates: (geom.coordinates as number[][][][]).map((poly) =>
          poly.map((ring) => ring.map(rp))
        ),
      }

    case 'GeometryCollection':
      return {
        ...geom,
        geometries: (geom.geometries as Array<Record<string, unknown>>).map((g) =>
          reprojectGeom(g, fromCrs, toCrs)
        ),
      }

    default:
      return geom
  }
}

// ── GeoArrow struct → GeoJSON ─────────────────────────────────────────────────

/**
 * Convert a GeoArrow struct value (returned by DuckDB WASM via Arrow) into a
 * GeoJSON Geometry object. The Arrow representation mirrors the DuckDB type:
 *
 * depth 0 → POINT_2D       : {x, y}
 * depth 1 → LINESTRING_2D  : [{x, y}, ...]
 * depth 2 → POLYGON_2D     : [[{x, y}, ...], ...]
 * depth 3 → MULTIPOLYGON_2D: [[[{x, y}, ...], ...], ...]
 *
 * Number() coercion handles the case where Arrow returns coordinate values as
 * strings rather than numbers (implementation detail that varies by version).
 */
function geoArrowToGeometry(data: unknown, depth: number): GeoJSON.Geometry | null {
  if (depth === 0) {
    const p = data as { x: unknown; y: unknown }
    return { type: 'Point', coordinates: [Number(p.x), Number(p.y)] }
  }
  if (depth === 1) {
    const pts = data as Array<{ x: unknown; y: unknown }>
    return { type: 'LineString', coordinates: pts.map((p) => [Number(p.x), Number(p.y)]) }
  }
  if (depth === 2) {
    const rings = data as Array<Array<{ x: unknown; y: unknown }>>
    return { type: 'Polygon', coordinates: rings.map((ring) => ring.map((p) => [Number(p.x), Number(p.y)])) }
  }
  if (depth === 3) {
    const polys = data as Array<Array<Array<{ x: unknown; y: unknown }>>>
    return {
      type: 'MultiPolygon',
      coordinates: polys.map((poly) => poly.map((ring) => ring.map((p) => [Number(p.x), Number(p.y)]))),
    }
  }
  return null
}

