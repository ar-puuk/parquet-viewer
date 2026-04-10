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
  loading: boolean
  error: string | null
  progress: number // 0–1
}

const CHUNK_SIZE = 1000

export function useGeoData(
  geoInfo: GeoInfo | null,
  schema: { name: string; type: string }[] | null
): GeoDataResult {
  const [features, setFeatures] = useState<GeoFeature[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const sessionRef = useRef(0)

  useEffect(() => {
    if (!geoInfo || !schema) {
      setFeatures([])
      setProgress(0)
      return
    }

    const session = ++sessionRef.current
    setFeatures([])
    setLoading(true)
    setError(null)
    setProgress(0)

    // Property columns: everything except the geometry column itself and BLOBs
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

    async function fetchAll() {
      try {
        // Get total row count
        const countRows = await queryDB('SELECT COUNT(*) AS cnt FROM data')
        if (session !== sessionRef.current) return
        const total = Number(countRows[0]?.['cnt'] ?? 0)
        if (total === 0) {
          setLoading(false)
          setProgress(1)
          return
        }

        const allFeatures: GeoFeature[] = []
        let offset = 0

        while (offset < total) {
          if (session !== sessionRef.current) return

          const sql = propSelect
            ? `SELECT ROW_NUMBER() OVER () + ${offset} - 1 AS __row_id, ${geoExpr} AS __geojson, ${propSelect}
               FROM data
               LIMIT ${CHUNK_SIZE} OFFSET ${offset}`
            : `SELECT ROW_NUMBER() OVER () + ${offset} - 1 AS __row_id, ${geoExpr} AS __geojson
               FROM data
               LIMIT ${CHUNK_SIZE} OFFSET ${offset}`

          const rows = await queryDB(sql)
          if (session !== sessionRef.current) return

          for (const row of rows) {
            const geojson = String(row['__geojson'] ?? '')
            if (!geojson || geojson === 'null') continue
            const properties: Record<string, unknown> = {}
            for (const col of propCols) {
              properties[col.name] = row[col.name]
            }
            allFeatures.push({
              __row_id: Number(row['__row_id']),
              geojson,
              properties,
            })
          }

          offset += CHUNK_SIZE
          setProgress(Math.min(offset / total, 1))
          // Yield partial results every chunk so map updates incrementally
          setFeatures([...allFeatures])
        }

        setProgress(1)
        setFeatures(allFeatures)
      } catch (e) {
        if (session !== sessionRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (session === sessionRef.current) setLoading(false)
      }
    }

    fetchAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoInfo, schema])

  return { features, loading, error, progress }
}
