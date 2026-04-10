import { useState, useRef, useCallback } from 'react'
import { queryDB } from './useDuckDB'
import { useAppStore } from '../store/useAppStore'

export const PAGE_SIZE = 500

export type SortDir = 'asc' | 'desc'
export interface SortState {
  column: string
  direction: SortDir
}

export interface TableRow {
  __row_id: number
  [key: string]: unknown
}

function buildQuery(limit: number, offset: number, sort: SortState | null): string {
  const orderBy = sort
    ? `ORDER BY "${sort.column}" ${sort.direction.toUpperCase()} NULLS LAST`
    : ''
  return `SELECT ROW_NUMBER() OVER () AS __row_id, * FROM data ${orderBy} LIMIT ${limit} OFFSET ${offset}`
}

export function useTableData() {
  const fileStats = useAppStore((s) => s.fileStats)
  const totalRows = fileStats?.rowCount ?? 0

  const [sort, setSort] = useState<SortState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadedCount, setLoadedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Bumped whenever cache data changes — gives DataTable a stable trigger to re-render rows
  const [cacheVersion, setCacheVersion] = useState(0)

  // Mutable refs: cache, inflight set, session counter
  const pageCacheRef = useRef(new Map<number, TableRow[]>())
  const pendingRef   = useRef(new Set<number>())
  const inflight     = useRef(0) // count of active fetches
  const sessionRef   = useRef(0)
  // Always-current sort so async callbacks don't capture stale state
  const sortRef      = useRef<SortState | null>(null)
  sortRef.current = sort

  // ─── Internal helpers ────────────────────────────────────────────────────

  function fetchPageIfNeeded(pageIndex: number) {
    if (pageCacheRef.current.has(pageIndex)) return
    if (pendingRef.current.has(pageIndex)) return
    if (pageIndex * PAGE_SIZE >= totalRows) return

    pendingRef.current.add(pageIndex)
    inflight.current++
    setIsLoading(true)
    const session = sessionRef.current

    ;(async () => {
      try {
        const offset = pageIndex * PAGE_SIZE
        const sql = buildQuery(PAGE_SIZE, offset, sortRef.current)
        const result = (await queryDB(sql)) as TableRow[]
        if (session !== sessionRef.current) return

        pageCacheRef.current.set(pageIndex, result)
        setLoadedCount((c) => c + result.length)
        setCacheVersion((v) => v + 1)
      } catch (e) {
        if (session !== sessionRef.current) return
        pendingRef.current.delete(pageIndex) // allow retry on next scroll
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (session === sessionRef.current) {
          inflight.current--
          if (inflight.current === 0) setIsLoading(false)
        }
      }
    })()
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Ensure all pages covering [startIdx, endIdx] are in the cache.
   * Called by DataTable after computing which rows are visible.
   */
  const prefetchRange = useCallback(
    (startIdx: number, endIdx: number) => {
      if (totalRows === 0) return
      const startPage = Math.floor(Math.max(0, startIdx) / PAGE_SIZE)
      const endPage   = Math.floor(Math.min(totalRows - 1, endIdx) / PAGE_SIZE)
      for (let p = startPage; p <= endPage; p++) {
        fetchPageIfNeeded(p)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalRows] // fetchPageIfNeeded reads only refs; stable while file is open
  )

  /** Look up a single row by absolute index. Returns undefined while page is loading. */
  const getRow = useCallback(
    (_cacheVersion: number, index: number): TableRow | undefined => {
      const page = Math.floor(index / PAGE_SIZE)
      return pageCacheRef.current.get(page)?.[index % PAGE_SIZE]
    },
    [] // reads ref directly; caller passes cacheVersion to bust memoization
  )

  /** True while the page containing this row index is still in-flight. */
  const isRowLoading = useCallback((index: number): boolean => {
    const page = Math.floor(index / PAGE_SIZE)
    return pendingRef.current.has(page) && !pageCacheRef.current.has(page)
  }, [])

  /** Toggle/cycle sort for a column; clears the cache synchronously. */
  const handleSetSort = useCallback((column: string) => {
    // Synchronous cache reset before the state update so the first re-render
    // after the sort change sees an empty cache (shows skeletons immediately).
    sessionRef.current++
    pageCacheRef.current = new Map()
    pendingRef.current   = new Set()
    inflight.current     = 0
    setLoadedCount(0)
    setIsLoading(false)
    setError(null)
    setCacheVersion(0)

    setSort((prev) => {
      if (prev?.column !== column) return { column, direction: 'asc' }
      if (prev.direction === 'asc') return { column, direction: 'desc' }
      return null // third click clears sort
    })
  }, [])

  return {
    totalRows,
    loadedCount,
    cacheVersion,
    getRow,
    isRowLoading,
    prefetchRange,
    isLoading,
    error,
    sort,
    setSort: handleSetSort,
  }
}
