import { useRef, useEffect, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTableData } from '../../hooks/useTableData'
import { useAppStore } from '../../store/useAppStore'
import { TableCell } from './TableCell'
import { getDefaultColWidth } from '../../utils/formatters'

const ROW_HEIGHT = 35
// Rows to prefetch beyond the visible window in each direction
const LOOKAHEAD = 200

export function DataTable() {
  const schema   = useAppStore((s) => s.schema)
  const {
    totalRows, loadedCount, cacheVersion,
    getRow, isRowLoading, prefetchRange,
    isLoading, error, sort, setSort,
  } = useTableData()

  const scrollRef  = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})

  // Visible columns — __row_id is in every row for Phase 5 sync but never shown
  const columns = schema?.filter((c) => c.name !== '__row_id') ?? []

  // Initialise default widths from schema
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

  const getWidth = (name: string) => colWidths[name] ?? 150
  const totalWidth = columns.reduce((sum, c) => sum + getWidth(c.name), 0)

  const rowVirtualizer = useVirtualizer({
    count: totalRows,           // ← full file size, not loaded rows
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Prefetch pages for currently visible rows + lookahead on both sides
  const virtualItems = rowVirtualizer.getVirtualItems()
  useEffect(() => {
    if (!virtualItems.length) return
    const firstIdx = virtualItems[0].index
    const lastIdx  = virtualItems[virtualItems.length - 1].index
    prefetchRange(firstIdx - LOOKAHEAD, lastIdx + LOOKAHEAD)
  }, [virtualItems, prefetchRange])

  // Column resize via mouse drag
  const startResize = useCallback((colName: string, startX: number) => {
    const startWidth = colWidths[colName] ?? 150
    const handleMove = (e: MouseEvent) => {
      const newWidth = Math.max(60, startWidth + e.clientX - startX)
      setColWidths((prev) => ({ ...prev, [colName]: newWidth }))
    }
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [colWidths])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-950">

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {loadedCount.toLocaleString()} of {totalRows.toLocaleString()} rows loaded
          {isLoading && (
            <span className="ml-2 inline-flex items-center gap-1 text-indigo-500 dark:text-indigo-400">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              fetching…
            </span>
          )}
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

      {/* Scrollable table */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: `${totalWidth}px` }}>

          {/* Sticky header */}
          <div
            className="flex sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700"
            style={{ minWidth: `${totalWidth}px` }}
          >
            {columns.map((col) => {
              const w = getWidth(col.name)
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
                    <span className="text-xs font-medium uppercase tracking-wide truncate">
                      {col.name}
                    </span>
                    {isActive && (
                      <span className="flex-shrink-0 text-xs">
                        {sort!.direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
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

          {/* Virtualised rows — count is totalRows, not loadedCount */}
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualItems.map((vRow) => {
              const row     = getRow(cacheVersion, vRow.index)
              const loading = !row && isRowLoading(vRow.index)
              const isEven  = vRow.index % 2 === 0

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
                  {loading ? (
                    // Skeleton row while page is in-flight
                    <div className="flex-1 flex items-center px-3 gap-3" style={{ height: ROW_HEIGHT }}>
                      {columns.map((col) => (
                        <div
                          key={col.name}
                          style={{ width: getWidth(col.name) - 16 }}
                          className="h-2 bg-gray-200 dark:bg-gray-800 rounded animate-pulse flex-shrink-0"
                        />
                      ))}
                    </div>
                  ) : (
                    columns.map((col) => {
                      const w = getWidth(col.name)
                      return (
                        <div
                          key={col.name}
                          style={{ width: w, minWidth: w, maxWidth: w, height: ROW_HEIGHT }}
                          className="border-r border-gray-100 dark:border-gray-800 last:border-r-0 flex-shrink-0 overflow-hidden"
                        >
                          <TableCell
                            value={row?.[col.name]}
                            colName={col.name}
                            colType={col.type}
                          />
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
