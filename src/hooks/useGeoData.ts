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
    const geoExpr =
      geo.encoding === 'wkb'
        ? `ST_AsGeoJSON(ST_GeomFromWKB("${geo.geometryColumn}"))`
        : `ST_AsGeoJSON(ST_GeomFromText("${geo.geometryColumn}"))`

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
          const geojson = String(row['__geojson'] ?? '')
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
