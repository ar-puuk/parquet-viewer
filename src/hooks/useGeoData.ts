import { useState, useEffect, useRef } from 'react'
import { queryDB } from './useDuckDB'
import type { GeoInfo } from '../types'

export interface GeoFeature {
  __row_id: number
  geojson: string
  properties: Record<string, unknown>
}

export interface GeoDataResult {
  features: GeoFeature[]
  totalCount: number
  loading: boolean
  error: string | null
}

export const GEO_PAGE_SIZE = 200

export function useGeoData(
  geoInfo: GeoInfo | null,
  schema: { name: string; type: string }[] | null,
  page: number,
): GeoDataResult {
  const [features, setFeatures] = useState<GeoFeature[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef(0)

  useEffect(() => {
    if (!geoInfo || !schema) {
      setFeatures([])
      setTotalCount(0)
      return
    }

    const session = ++sessionRef.current
    setFeatures([])
    setLoading(true)
    setError(null)

    const propCols = schema.filter(
      (c) =>
        c.name !== geoInfo.geometryColumn &&
        c.name !== '__row_id' &&
        c.type.split('(')[0].toUpperCase().trim() !== 'BLOB'
    )

    const propSelect = propCols.map((c) => `"${c.name}"`).join(', ')
    const geoExpr =
      geoInfo.encoding === 'wkb'
        ? `ST_AsGeoJSON(ST_GeomFromWKB("${geoInfo.geometryColumn}"))`
        : `ST_AsGeoJSON(ST_GeomFromText("${geoInfo.geometryColumn}"))`

    const offset = page * GEO_PAGE_SIZE

    async function fetchPage() {
      try {
        // Fetch total count and page data in parallel
        const [countRows, rows] = await Promise.all([
          page === 0 ? queryDB('SELECT COUNT(*) AS cnt FROM data') : Promise.resolve(null),
          queryDB(
            propSelect
              ? `SELECT ROW_NUMBER() OVER () + ${offset} - 1 AS __row_id,
                        ${geoExpr} AS __geojson,
                        ${propSelect}
                 FROM data
                 LIMIT ${GEO_PAGE_SIZE} OFFSET ${offset}`
              : `SELECT ROW_NUMBER() OVER () + ${offset} - 1 AS __row_id,
                        ${geoExpr} AS __geojson
                 FROM data
                 LIMIT ${GEO_PAGE_SIZE} OFFSET ${offset}`
          ),
        ])

        if (session !== sessionRef.current) return

        // Yield before processing the (potentially large) DuckDB result payload
        // so we don't block the main thread inside the message handler.
        await new Promise<void>((r) => setTimeout(r, 0))
        if (session !== sessionRef.current) return

        if (countRows) {
          setTotalCount(Number(countRows[0]?.['cnt'] ?? 0))
        }

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

    fetchPage()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoInfo, schema, page])

  // When geoInfo/schema change (new file), reset total count
  useEffect(() => {
    setTotalCount(0)
  }, [geoInfo, schema])

  return { features, totalCount, loading, error }
}
