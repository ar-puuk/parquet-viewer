import { useState, useEffect, useRef } from 'react'
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
 * The __row_id in the geo result matches the __row_id in queryResult rows so
 * Phase 5 map↔table sync can correlate them.
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

    // No query result yet — show nothing on map (user hasn't run a query)
    if (!queryResult) {
      setFeatures([])
      return
    }

    const session = ++sessionRef.current
    setFeatures([])
    setLoading(true)
    setError(null)

    const geo = geoInfo  // narrow to non-null for use inside async closure

    // Build the GeoJSON expression. Strategy per encoding:
    //
    // 'native'  = DuckDB GEOMETRY type → use directly
    // 'struct'  = GeoArrow struct alias (POINT_2D / POLYGON_2D / etc.).
    //             DuckDB WASM has no cast to GEOMETRY and ST_AsGeoJSON only
    //             accepts GEOMETRY in this build. Build WKT manually from the
    //             struct coordinates using list_transform + list_aggregate,
    //             then convert via ST_GeomFromText. The geometry type (POINT,
    //             LINESTRING, POLYGON, MULTIPOLYGON) is inferred from the
    //             array nesting depth of the column type.
    // 'wkb'/'wkt' = binary/text → ST_GeomFromWKB / ST_GeomFromText
    const col = `"${geo.geometryColumn}"`
    const epsgFrom = geo.epsg != null && geo.epsg !== 4326 ? geo.epsg : null

    let geoExpr: string
    if (geo.encoding === 'native') {
      const geomExpr = col
      geoExpr = epsgFrom
        ? `ST_AsGeoJSON(ST_Transform(${geomExpr}, 'EPSG:${epsgFrom}', 'EPSG:4326'))`
        : `ST_AsGeoJSON(${geomExpr})`
    } else if (geo.encoding === 'struct') {
      const wktExpr = buildStructWktExpr(col, geo.structType ?? '')
      const geomExpr = `ST_GeomFromText(${wktExpr})`
      geoExpr = epsgFrom
        ? `ST_AsGeoJSON(ST_Transform(${geomExpr}, 'EPSG:${epsgFrom}', 'EPSG:4326'))`
        : `ST_AsGeoJSON(${geomExpr})`
    } else {
      const geomExpr = geo.encoding === 'wkt'
        ? `ST_GeomFromText(${col})`
        : `ST_GeomFromWKB(${col})`
      geoExpr = epsgFrom
        ? `ST_AsGeoJSON(ST_Transform(${geomExpr}, 'EPSG:${epsgFrom}', 'EPSG:4326'))`
        : `ST_AsGeoJSON(${geomExpr})`
    }

    // Property columns: everything except the geometry column and __row_id
    const propCols = schema.filter(
      (c) =>
        c.name !== geo.geometryColumn &&
        c.name !== '__row_id' &&
        c.type.split('(')[0].toUpperCase().trim() !== 'BLOB'
    )
    const propSelect = propCols.map((c) => `"${c.name}"`).join(', ')

    // Check whether the geometry column appears in the query result columns.
    // If it does, we can build the geo query from the user's SQL directly.
    const geoInResult = queryResult.columns.includes(geo.geometryColumn)

    // Number of rows in the query result — use same limit for geo companion.
    const limit = queryResult.rows.length || 1000

    async function fetchFeatures() {
      try {
        let sql: string

        if (geoInResult) {
          // Geometry column is present in the result — wrap the original query
          // so the geometry data comes from the same filtered/ordered result set.
          sql = propSelect
            ? `SELECT (ROW_NUMBER() OVER () - 1) AS __row_id,
                      ${geoExpr} AS __geojson,
                      ${propSelect}
               FROM (${queryResult!.sql}) AS _q`
            : `SELECT (ROW_NUMBER() OVER () - 1) AS __row_id,
                      ${geoExpr} AS __geojson
               FROM (${queryResult!.sql}) AS _q`
        } else {
          // Geometry column was excluded from the user query (e.g. SELECT * EXCLUDE).
          // Re-query the base table with the same limit so map ≈ table.
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

        // Yield before processing to avoid blocking the main thread
        await new Promise<void>((r) => setTimeout(r, 0))
        if (session !== sessionRef.current) return

        const pageFeatures: GeoFeature[] = []
        for (const row of rows) {
          const raw = row['__geojson']
          const geojson = raw == null ? '' :
            typeof raw === 'string' ? raw :
            typeof raw === 'object' ? JSON.stringify(raw) :
            String(raw)
          if (!geojson || geojson === 'null') continue
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a DuckDB SQL expression that produces a WKT string from a GeoArrow
 * struct column (POINT_2D / LINESTRING_2D / POLYGON_2D / MULTIPOLYGON_2D).
 *
 * DuckDB WASM does not support CAST(struct AS GEOMETRY) and ST_AsGeoJSON only
 * accepts GEOMETRY in this build, so we reconstruct WKT using pure SQL list
 * and string functions that work on the raw struct values.
 *
 * Depth is inferred from the number of [] pairs in the DuckDB type string:
 *   0 = POINT_2D      (STRUCT(x, y))
 *   1 = LINESTRING_2D (STRUCT(x, y)[])
 *   2 = POLYGON_2D    (STRUCT(x, y)[][])
 *   3 = MULTIPOLYGON  (STRUCT(x, y)[][][])
 */
function buildStructWktExpr(col: string, structType: string): string {
  const depth = (structType.match(/\[\]/g) ?? []).length

  // coord pair as "x y"
  const coordPair = (pt: string) =>
    `${pt}.x::VARCHAR || ' ' || ${pt}.y::VARCHAR`

  // ring → "(x1 y1,x2 y2,...)"
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
      // Unknown depth — fall back to polygon interpretation
      return (
        `('POLYGON(' || ` +
        `list_aggregate(list_transform(${col}, _r -> ${ringWkt('_r')}), 'string_agg', ',') || ')')`
      )
  }
}
