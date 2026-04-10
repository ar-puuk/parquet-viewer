import { useState, useEffect, useRef, useCallback } from 'react'
import { queryDB } from './useDuckDB'
import { useAppStore } from '../store/useAppStore'

const PAGE_SIZE = 500

export type SortDir = 'asc' | 'desc'
export interface SortState {
  column: string
  direction: SortDir
}

export interface TableRow {
  __row_id: number
  [key: string]: unknown
}

interface UseTableDataReturn {
  rows: TableRow[]
  loadingMore: boolean
  loadingAll: boolean
  hasMore: boolean
  error: string | null
  sort: SortState | null
  setSort: (column: string) => void
  fetchNextPage: () => void
  loadAll: () => void
}

function buildQuery(limit: number, offset: number, sort: SortState | null): string {
  const orderBy = sort
    ? `ORDER BY "${sort.column}" ${sort.direction.toUpperCase()} NULLS LAST`
    : ''
  return `SELECT ROW_NUMBER() OVER () AS __row_id, * FROM data ${orderBy} LIMIT ${limit} OFFSET ${offset}`
}

export function useTableData(): UseTableDataReturn {
  const activeFile = useAppStore((s) => s.activeFile)

  const [rows, setRows] = useState<TableRow[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState | null>(null)

  // Incremented each time we start a new fetch session (file change, sort change).
  // Allows in-flight fetches to detect they've been superseded and discard results.
  const sessionRef = useRef(0)

  // Reset + fetch first page whenever file or sort changes
  useEffect(() => {
    if (!activeFile) {
      setRows([])
      setOffset(0)
      setHasMore(false)
      return
    }

    const session = ++sessionRef.current
    setRows([])
    setOffset(0)
    setHasMore(false)
    setError(null)
    setLoadingMore(true)
    ;(async () => {
      try {
        const sql = buildQuery(PAGE_SIZE, 0, sort)
        const result = (await queryDB(sql)) as TableRow[]
        if (session !== sessionRef.current) return
        const totalRows = useAppStore.getState().fileStats?.rowCount ?? 0
        setRows(result)
        setOffset(result.length)
        setHasMore(result.length < totalRows)
      } catch (e) {
        if (session !== sessionRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (session === sessionRef.current) setLoadingMore(false)
      }
    })()
  // Derived keys intentionally: re-run only when file identity or sort values change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.registeredAs, sort?.column, sort?.direction])

  const fetchNextPage = useCallback(() => {
    if (loadingMore || loadingAll || !hasMore) return
    const session = sessionRef.current
    const currentOffset = offset
    const currentSort = sort

    setLoadingMore(true)
    ;(async () => {
      try {
        const sql = buildQuery(PAGE_SIZE, currentOffset, currentSort)
        const result = (await queryDB(sql)) as TableRow[]
        if (session !== sessionRef.current) return
        const totalRows = useAppStore.getState().fileStats?.rowCount ?? 0
        setRows((prev) => [...prev, ...result])
        const newOffset = currentOffset + result.length
        setOffset(newOffset)
        setHasMore(newOffset < totalRows)
      } catch (e) {
        if (session !== sessionRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (session === sessionRef.current) setLoadingMore(false)
      }
    })()
  }, [loadingMore, loadingAll, hasMore, offset, sort])

  const loadAll = useCallback(() => {
    const fileStats = useAppStore.getState().fileStats
    if (!fileStats || loadingAll) return

    const session = ++sessionRef.current
    const currentSort = sort
    const totalRows = fileStats.rowCount

    setLoadingAll(true)
    setError(null)
    ;(async () => {
      try {
        // Fetch all pages in sequence, building up the full dataset
        const allRows: TableRow[] = []
        let off = 0
        while (off < totalRows) {
          if (session !== sessionRef.current) return
          const sql = buildQuery(PAGE_SIZE, off, currentSort)
          const batch = (await queryDB(sql)) as TableRow[]
          if (session !== sessionRef.current) return
          allRows.push(...batch)
          off += batch.length
          setRows([...allRows]) // update progressively so UI reflects progress
          if (batch.length < PAGE_SIZE) break
        }
        setOffset(allRows.length)
        setHasMore(false)
      } catch (e) {
        if (session !== sessionRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (session === sessionRef.current) setLoadingAll(false)
      }
    })()
  }, [loadingAll, sort])

  const handleSetSort = useCallback((column: string) => {
    setSort((prev) => {
      if (prev?.column !== column) return { column, direction: 'asc' }
      if (prev.direction === 'asc') return { column, direction: 'desc' }
      return null // third click: clear sort
    })
  }, [])

  return {
    rows,
    loadingMore,
    loadingAll,
    hasMore,
    error,
    sort,
    setSort: handleSetSort,
    fetchNextPage,
    loadAll,
  }
}
