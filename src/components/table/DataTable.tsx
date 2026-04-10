import { useRef, useEffect, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTableData, PAGE_SIZE } from '../../hooks/useTableData'
import { useAppStore } from '../../store/useAppStore'
import { TableCell } from './TableCell'
import { getDefaultColWidth } from '../../utils/formatters'

const ROW_HEIGHT = 35

// ── Pagination ───────────────────────────────────────────────────────────────

function TablePagination({
  page,
  totalPages,
  loading,
  onPage,
}: {
  page: number
  totalPages: number
  loading: boolean
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null

  // Window: first, last, current ± 1, with ellipsis gaps
  const pages: (number | '…')[] = []
  const push = (p: number) => { if (pages[pages.length - 1] !== p) pages.push(p) }
  push(0)
  if (page > 2) pages.push('…')
  for (let p = Math.max(1, page - 1); p <= Math.min(totalPages - 2, page + 1); p++) push(p)
  if (page < totalPages - 3) pages.push('…')
  if (totalPages > 1) push(totalPages - 1)

  return (
    <div className="flex items-center justify-center gap-1 px-3 py-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 0 || loading}
        className="px-2 py-1 text-xs rounded disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >←</button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-1 text-xs text-gray-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            disabled={loading}
            className={`min-w-[28px] px-1.5 py-1 text-xs rounded transition-colors disabled:cursor-not-allowed ${
              p === page
                ? 'bg-indigo-600 text-white'
                : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            {(p as number) + 1}
          </button>
        )
      )}

      <button
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages - 1 || loading}
        className="px-2 py-1 text-xs rounded disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >→</button>

      {loading && (
        <svg className="ml-1 animate-spin w-3 h-3 text-indigo-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
    </div>
  )
}

// ── DataTable ────────────────────────────────────────────────────────────────

export function DataTable() {
  const schema = useAppStore((s) => s.schema)
  const { rows, totalRows, totalPages, page, isLoading, error, sort, setSort, setPage } = useTableData()

  const scrollRef  = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})

  // __row_id is an internal sync key — never shown in the table UI
  const columns = schema?.filter((c) => c.name !== '__row_id') ?? []

  // Initialise default column widths when schema first loads
  useEffect(() => {
    if (!schema) return
    setColWidths(
      Object.fromEntries(
        schema
          .filter((c) => c.name !== '__row_id')
          .map((c) => [c.name, getDefaultColWidth(c.type, c.name)])
      )
    )
  }, [schema])

  // Scroll back to the top whenever the page or sort order changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [page, sort])

  const getWidth   = (name: string) => colWidths[name] ?? 150
  const totalWidth = columns.reduce((sum, c) => sum + getWidth(c.name), 0)

  // Virtualise only the rows we have in memory (current page, ≤ PAGE_SIZE)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Column resize via mouse drag
  const startResize = useCallback((colName: string, startX: number) => {
    const startWidth = colWidths[colName] ?? 150
    const handleMove = (e: MouseEvent) => {
      setColWidths((prev) => ({ ...prev, [colName]: Math.max(60, startWidth + e.clientX - startX) }))
    }
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [colWidths])

  const startRow = page * PAGE_SIZE + 1
  const endRow   = Math.min((page + 1) * PAGE_SIZE, totalRows)

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-950">

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {totalRows > 0
            ? <>rows {startRow.toLocaleString()}–{endRow.toLocaleString()} of {totalRows.toLocaleString()}</>
            : 'No data'}
        </span>
        {sort && (
          <span className="text-xs text-indigo-500 dark:text-indigo-400">
            Sorted by {sort.column} {sort.direction === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950 text-xs text-red-600 dark:text-red-400 border-b border-red-200 dark:border-red-800 flex-shrink-0">
          {error}
        </div>
      )}

      {/* Table area — relative so the loading overlay can be positioned inside */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-auto">
          <div style={{ minWidth: `${totalWidth}px` }}>

            {/* Sticky header */}
            <div
              className="flex sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700"
              style={{ minWidth: `${totalWidth}px` }}
            >
              {columns.map((col) => {
                const w        = getWidth(col.name)
                const isActive = sort?.column === col.name
                return (
                  <div
                    key={col.name}
                    style={{ width: w, minWidth: w, maxWidth: w }}
                    className="relative flex items-center group border-r border-gray-200 dark:border-gray-700 last:border-r-0 flex-shrink-0"
                  >
                    <button
                      onClick={() => setSort(col.name)}
                      className={`flex-1 flex items-center gap-1 px-2 py-2 text-left overflow-hidden ${
                        isActive
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                      }`}
                    >
                      <span className="text-xs font-medium uppercase tracking-wide truncate">{col.name}</span>
                      {isActive && <span className="flex-shrink-0 text-xs">{sort!.direction === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => { e.preventDefault(); startResize(col.name, e.clientX) }}
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 bg-indigo-400 transition-opacity"
                    />
                  </div>
                )
              })}
            </div>

            {/* Virtualised rows — only the current page is in memory */}
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const row    = rows[vRow.index]
                const isEven = vRow.index % 2 === 0
                return (
                  <div
                    key={vRow.key}
                    data-index={vRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vRow.start}px)`,
                      minWidth: `${totalWidth}px`,
                    }}
                    className={`flex border-b border-gray-100 dark:border-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors ${
                      isEven ? 'bg-white dark:bg-gray-950' : 'bg-gray-50/50 dark:bg-gray-900/50'
                    }`}
                  >
                    {columns.map((col) => {
                      const w = getWidth(col.name)
                      return (
                        <div
                          key={col.name}
                          style={{ width: w, minWidth: w, maxWidth: w, height: ROW_HEIGHT }}
                          className="border-r border-gray-100 dark:border-gray-800 last:border-r-0 flex-shrink-0 overflow-hidden"
                        >
                          <TableCell value={row?.[col.name]} colName={col.name} colType={col.type} />
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Loading overlay — shown while the page query is in-flight */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-gray-950/60">
            <div className="flex items-center gap-2 bg-white dark:bg-gray-900 px-4 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
              <svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span className="text-xs text-gray-600 dark:text-gray-400">Loading…</span>
            </div>
          </div>
        )}
      </div>

      {/* Pagination footer */}
      <TablePagination page={page} totalPages={totalPages} loading={isLoading} onPage={setPage} />
    </div>
  )
}
