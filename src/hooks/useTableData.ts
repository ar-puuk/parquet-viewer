import { useState, useRef, useCallback, useMemo } from 'react'
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

function buildQuery(selectCols: string, limit: number, offset: number, sort: SortState | null): string {
  const orderBy = sort
    ? `ORDER BY "${sort.column}" ${sort.direction.toUpperCase()} NULLS LAST`
    : ''
  return `SELECT ROW_NUMBER() OVER () AS __row_id, ${selectCols} FROM data ${orderBy} LIMIT ${limit} OFFSET ${offset}`
}

export function useTableData() {
  const fileStats = useAppStore((s) => s.fileStats)
  const schema    = useAppStore((s) => s.schema)
  const totalRows = fileStats?.rowCount ?? 0

  // Exclude BLOB columns from every table page query. BLOB (geometry/binary)
  // values can be 10-100 KB each — fetching them for 500 rows at a time causes
  // massive DuckDB worker postMessage payloads that block the main thread.
  // TableCell already renders a placeholder for these columns regardless.
  const selectCols = useMemo(() => {
    if (!schema || schema.length === 0) return '*'
    const nonBlob = schema.filter(
      (c) => c.type.split('(')[0].toUpperCase().trim() !== 'BLOB'
    )
    return nonBlob.length > 0 ? nonBlob.map((c) => `"${c.name}"`).join(', ') : '*'
  }, [schema])

  const [sort, setSort] = useState<SortState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadedCount, setLoadedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cacheVersion, setCacheVersion] = useState(0)

  const pageCacheRef  = useRef(new Map<number, TableRow[]>())
  const pendingRef    = useRef(new Set<number>())
  const inflight      = useRef(0)
  const sessionRef    = useRef(0)
  const sortRef       = useRef<SortState | null>(null)
  const selectColsRef = useRef(selectCols)
  sortRef.current       = sort
  selectColsRef.current = selectCols

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
        const sql = buildQuery(selectColsRef.current, PAGE_SIZE, offset, sortRef.current)
        const result = (await queryDB(sql)) as TableRow[]
        if (session !== sessionRef.current) return

        pageCacheRef.current.set(pageIndex, result)
        setLoadedCount((c) => c + result.length)
        setCacheVersion((v) => v + 1)
      } catch (e) {
        if (session !== sessionRef.current) return
        pendingRef.current.delete(pageIndex)
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
    [totalRows]
  )

  const getRow = useCallback(
    (_cacheVersion: number, index: number): TableRow | undefined => {
      const page = Math.floor(index / PAGE_SIZE)
      return pageCacheRef.current.get(page)?.[index % PAGE_SIZE]
    },
    []
  )

  const isRowLoading = useCallback((index: number): boolean => {
    const page = Math.floor(index / PAGE_SIZE)
    return pendingRef.current.has(page) && !pageCacheRef.current.has(page)
  }, [])

  const handleSetSort = useCallback((column: string) => {
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
      return null
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
