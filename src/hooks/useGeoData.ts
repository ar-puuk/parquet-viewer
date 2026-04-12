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
      geoExpr = `ST_AsGeoJSON(${col})`
    } else if (geo.encoding === 'struct') {
      const wktExpr = buildStructWktExpr(col, geo.structType ?? '')
      geoExpr = `ST_AsGeoJSON(ST_GeomFromText(${wktExpr}))`
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
          let geojson = raw == null ? '' :
            typeof raw === 'string' ? raw :
            typeof raw === 'object' ? JSON.stringify(raw) :
            String(raw)
          if (!geojson || geojson === 'null') continue

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a DuckDB SQL expression that produces a WKT string from a GeoArrow
 * struct column (POINT_2D / LINESTRING_2D / POLYGON_2D / MULTIPOLYGON_2D).
 */
function buildStructWktExpr(col: string, structType: string): string {
  const depth = (structType.match(/\[\]/g) ?? []).length

  const coordPair = (pt: string) =>
    `${pt}.x::VARCHAR || ' ' || ${pt}.y::VARCHAR`

  const ringWkt = (ring: string) =>
    `'(' || list_aggregate(list_transform(${ring}, _p -> ${coordPair('_p')}), 'string_agg', ',') || ')'`

  switch (depth) {
    case 0:
      return `('POINT(' || ${coordPair(col)} || ')')`

    case 1:
      return `('LINESTRING(' || list_aggregate(list_transform(${col}, _p -> ${coordPair('_p')}), 'string_agg', ',') || ')')`

    case 2:
      return (
        `('POLYGON(' || ` +
        `list_aggregate(list_transform(${col}, _r -> ${ringWkt('_r')}), 'string_agg', ',') || ')')`
      )

    case 3:
      return (
        `('MULTIPOLYGON(' || ` +
        `list_aggregate(list_transform(${col}, _o -> ` +
          `'(' || list_aggregate(list_transform(_o, _r -> ${ringWkt('_r')}), 'string_agg', ',') || ')'), ` +
        `'string_agg', ',') || ')')`
      )

    default:
      return (
        `('POLYGON(' || ` +
        `list_aggregate(list_transform(${col}, _r -> ${ringWkt('_r')}), 'string_agg', ',') || ')')`
      )
  }
}
