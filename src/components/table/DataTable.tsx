import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore } from '../../store/useAppStore'
import { TableCell } from './TableCell'
import { getDefaultColWidth, isNumericType } from '../../utils/formatters'

const ROW_HEIGHT = 35

export function DataTable() {
  const schema          = useAppStore((s) => s.schema)
  const queryResult     = useAppStore((s) => s.queryResult)
  const hoveredRowId    = useAppStore((s) => s.hoveredRowId)
  const selectedRowId   = useAppStore((s) => s.selectedRowId)
  const setHoveredRowId = useAppStore((s) => s.setHoveredRowId)
  const setSelectedRowId = useAppStore((s) => s.setSelectedRowId)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})

  const rows = queryResult?.rows ?? []

  // Derive display columns from query result columns, excluding __row_id.
  // Cross-reference with schema for type info; fall back to value inference.
  const columns = useMemo(() => {
    if (!queryResult) return []
    return queryResult.columns
      .filter((name) => name !== '__row_id')
      .map((name) => ({
        name,
        type: schema?.find((c) => c.name === name)?.type ?? '',
      }))
  }, [queryResult, schema])

  // Initialise column widths whenever the result columns change
  useEffect(() => {
    setColWidths(
      Object.fromEntries(
        columns.map((c) => [c.name, getDefaultColWidth(c.type, c.name)])
      )
    )
  }, [columns])

  const getWidth   = (name: string) => colWidths[name] ?? 150
  const totalWidth = columns.reduce((sum, c) => sum + getWidth(c.name), 0)

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Scroll the virtualizer to keep the selected row in view whenever
  // selectedRowId changes (triggered by a map-feature click).
  useEffect(() => {
    if (selectedRowId == null) return
    const idx = rows.findIndex((r) => Number(r.__row_id) === selectedRowId)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'center' })
  // rowVirtualizer instance is stable; rows identity changes when query runs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowId])

  const startResize = useCallback((colName: string, startX: number) => {
    const startWidth = colWidths[colName] ?? 150
    const onMove = (e: MouseEvent) => {
      setColWidths((prev) => ({ ...prev, [colName]: Math.max(60, startWidth + e.clientX - startX) }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [colWidths])

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!queryResult) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-950">
        <p className="text-sm text-gray-400 dark:text-gray-600 select-none">
          Run a query to see results
        </p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-950">
        <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
          <span className="text-xs text-gray-500 dark:text-gray-400">0 rows returned</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400 dark:text-gray-600 select-none">No rows matched</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-950">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Scrollable table */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: `${totalWidth}px` }}>

          {/* Sticky header */}
          <div
            className="flex sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700"
            style={{ minWidth: `${totalWidth}px` }}
          >
            {columns.map((col) => {
              const w        = getWidth(col.name)
              const isNum    = isNumericType(col.type)
              return (
                <div
                  key={col.name}
                  style={{ width: w, minWidth: w, maxWidth: w }}
                  className="relative flex items-center group border-r border-gray-200 dark:border-gray-700 last:border-r-0 flex-shrink-0"
                >
                  <div className={`flex-1 flex items-center px-2 py-2 overflow-hidden ${isNum ? 'justify-end' : ''}`}>
                    <span className="text-xs font-medium uppercase tracking-wide truncate text-gray-500 dark:text-gray-400">
                      {col.name}
                    </span>
                  </div>
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => { e.preventDefault(); startResize(col.name, e.clientX) }}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 bg-indigo-400 transition-opacity"
                  />
                </div>
              )
            })}
          </div>

          {/* Virtualised rows */}
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const row        = rows[vRow.index]
              const rowId      = row != null ? Number(row.__row_id) : null
              const isEven     = vRow.index % 2 === 0
              const isHovered  = rowId != null && rowId === hoveredRowId
              const isSelected = rowId != null && rowId === selectedRowId
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
                  className={`flex border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-indigo-100 dark:bg-indigo-900/60'
                      : isHovered
                      ? 'bg-indigo-50 dark:bg-indigo-950/60'
                      : isEven
                      ? 'bg-white dark:bg-gray-950'
                      : 'bg-gray-50/50 dark:bg-gray-900/50'
                  }`}
                  onMouseEnter={() => rowId != null && setHoveredRowId(rowId)}
                  onMouseLeave={() => setHoveredRowId(null)}
                  onClick={() => rowId != null && setSelectedRowId(rowId)}
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
    </div>
  )
}
