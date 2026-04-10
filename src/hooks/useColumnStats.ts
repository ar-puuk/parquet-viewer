import { useState, useCallback } from 'react'
import { queryDB } from './useDuckDB'
import { isGeometryColumn, isNumericType } from '../utils/formatters'

export interface ColumnStats {
  minVal: string | null
  maxVal: string | null
  nullCount: number
  distinctCount: number
  totalSampled: number
}

interface UseColumnStatsReturn {
  stats: ColumnStats | null
  loading: boolean
  error: string | null
  loadStats: (colName: string, colType: string) => Promise<void>
  clearStats: () => void
}

const SAMPLE_LIMIT = 10_000

export function useColumnStats(): UseColumnStatsReturn {
  const [stats, setStats] = useState<ColumnStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStats = useCallback(async (colName: string, colType: string) => {
    setLoading(true)
    setError(null)
    setStats(null)

    const col = `"${colName}"`
    const canMinMax = !isGeometryColumn(colName, colType)
    // Dates, booleans, and numerics support MIN/MAX. Blobs/geometry do not.
    const canDistinct = !isGeometryColumn(colName, colType)

    try {
      // Counts query always works
      const countSql = `
        SELECT
          COUNT(*) FILTER (WHERE ${col} IS NULL) AS null_count,
          ${canDistinct ? `COUNT(DISTINCT ${col})` : 'NULL'} AS distinct_count,
          COUNT(*) AS total
        FROM (SELECT ${col} FROM data LIMIT ${SAMPLE_LIMIT})
      `
      const countRows = await queryDB(countSql)
      const nullCount = Number(countRows[0]?.['null_count'] ?? 0)
      const distinctCount = canDistinct ? Number(countRows[0]?.['distinct_count'] ?? 0) : 0
      const total = Number(countRows[0]?.['total'] ?? 0)

      let minVal: string | null = null
      let maxVal: string | null = null

      if (canMinMax) {
        try {
          const minMaxSql = `
            SELECT
              CAST(MIN(${col}) AS VARCHAR) AS min_val,
              CAST(MAX(${col}) AS VARCHAR) AS max_val
            FROM (SELECT ${col} FROM data LIMIT ${SAMPLE_LIMIT})
          `
          const minMaxRows = await queryDB(minMaxSql)
          minVal = (minMaxRows[0]?.['min_val'] as string | null) ?? null
          maxVal = (minMaxRows[0]?.['max_val'] as string | null) ?? null
        } catch {
          // Silently skip if MIN/MAX fails for this type
        }
      }

      // For numeric types, add a helpful formatted range
      if (isNumericType(colType) && minVal !== null && maxVal !== null) {
        const mn = parseFloat(minVal)
        const mx = parseFloat(maxVal)
        if (!isNaN(mn)) minVal = mn.toLocaleString()
        if (!isNaN(mx)) maxVal = mx.toLocaleString()
      }

      setStats({ minVal, maxVal, nullCount, distinctCount, totalSampled: total })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const clearStats = useCallback(() => {
    setStats(null)
    setError(null)
  }, [])

  return { stats, loading, error, loadStats, clearStats }
}
