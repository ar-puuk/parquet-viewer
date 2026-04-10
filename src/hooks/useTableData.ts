import { useState, useCallback, useMemo, useEffect } from 'react'
import { queryDB } from './useDuckDB'
import { useAppStore } from '../store/useAppStore'

export const PAGE_SIZE = 1000

export type SortDir = 'asc' | 'desc'
export interface SortState {
  column: string
  direction: SortDir
}

export interface TableRow {
  __row_id: number
  [key: string]: unknown
}

// Subquery isolates LIMIT/OFFSET so ROW_NUMBER() only runs on the page rows,
// not the full table. Without this, DuckDB materialises all rows for the
// window function before applying the LIMIT.
function buildQuery(selectCols: string, limit: number, offset: number, sort: SortState | null): string {
  if (sort) {
    const orderBy = `ORDER BY "${sort.column}" ${sort.direction.toUpperCase()} NULLS LAST`
    return `SELECT (ROW_NUMBER() OVER () + ${offset}) AS __row_id, ${selectCols}
            FROM (SELECT ${selectCols} FROM data ${orderBy} LIMIT ${limit} OFFSET ${offset}) AS _page`
  }
  return `SELECT (ROW_NUMBER() OVER () + ${offset}) AS __row_id, ${selectCols}
          FROM (SELECT ${selectCols} FROM data LIMIT ${limit} OFFSET ${offset}) AS _page`
}

export function useTableData() {
  const fileStats = useAppStore((s) => s.fileStats)
  const schema    = useAppStore((s) => s.schema)
  const totalRows = fileStats?.rowCount ?? 0

  // Exclude BLOB columns from every query — geometry/binary values can be
  // 10–100 KB each, causing massive DuckDB→main-thread postMessage payloads.
  const selectCols = useMemo(() => {
    if (!schema || schema.length === 0) return '*'
    const nonBlob = schema.filter(
      (c) => c.type.split('(')[0].toUpperCase().trim() !== 'BLOB'
    )
    return nonBlob.length > 0 ? nonBlob.map((c) => `"${c.name}"`).join(', ') : '*'
  }, [schema])

  const [page, setPageState] = useState(0)
  const [sort, setSortState] = useState<SortState | null>(null)
  const [rows, setRows]       = useState<TableRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const totalPages = totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : 0

  // Fetch the current page whenever page, sort, or schema changes.
  useEffect(() => {
    if (!schema || totalRows === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)

    const offset = page * PAGE_SIZE
    const sql = buildQuery(selectCols, PAGE_SIZE, offset, sort)

    ;(async () => {
      try {
        const result = await queryDB(sql)
        if (cancelled) return
        // Yield to let the browser paint before committing rows to state.
        await new Promise<void>((r) => setTimeout(r, 0))
        if (cancelled) return
        setRows(result as TableRow[])
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [page, sort, selectCols, totalRows, schema])

  const setPage = useCallback((p: number) => {
    setPageState(Math.max(0, p))
  }, [])

  // Cycling sort: none → asc → desc → none. Resets to page 0 on change.
  const setSort = useCallback((column: string) => {
    setPageState(0)
    setSortState((prev) => {
      if (prev?.column !== column) return { column, direction: 'asc' }
      if (prev.direction === 'asc')  return { column, direction: 'desc' }
      return null
    })
  }, [])

  return { rows, totalRows, totalPages, page, isLoading, error, sort, setSort, setPage }
}
