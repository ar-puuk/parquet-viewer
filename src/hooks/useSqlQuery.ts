import { useState, useCallback } from 'react'
import { queryDBWithColumns } from './useDuckDB'
import { useAppStore } from '../store/useAppStore'

export function useSqlQuery() {
  const setQueryResult = useAppStore((s) => s.setQueryResult)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const runQuery = useCallback(async (sql: string) => {
    const trimmed = sql.trim()
    if (!trimmed) return
    setIsRunning(true)
    setError(null)

    const start = performance.now()
    try {
      // Wrap query so every result has a stable __row_id for Phase 5 map↔table sync.
      // The subquery ensures ROW_NUMBER() only runs over the result rows, not the
      // full table (same subquery optimisation used in useTableData / useGeoData).
      const wrapped = `SELECT ROW_NUMBER() OVER () AS __row_id, _q.* FROM (${trimmed}) AS _q`
      const { rows, columns } = await queryDBWithColumns(wrapped)
      const executionMs = Math.round(performance.now() - start)
      setQueryResult({ rows, columns, sql: trimmed, executionMs })
    } catch (wrapErr) {
      // Wrapper failed (e.g. the user wrote something that can't be a subquery).
      // Fall back to running the query as-is without __row_id injection.
      try {
        const { rows, columns } = await queryDBWithColumns(trimmed)
        const executionMs = Math.round(performance.now() - start)
        setQueryResult({ rows, columns, sql: trimmed, executionMs })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setIsRunning(false)
    }
  }, [setQueryResult])

  const clearError = useCallback(() => setError(null), [])

  return { runQuery, isRunning, error, clearError }
}
