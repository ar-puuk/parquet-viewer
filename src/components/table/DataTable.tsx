import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore } from '../../store/useAppStore'
import { TableCell } from './TableCell'
import { getDefaultColWidth, isNumericType } from '../../utils/formatters'

const ROW_HEIGHT = 35

type SortDir = 'asc' | 'desc'

export function DataTable() {
  const schema           = useAppStore((s) => s.schema)
  const queryResult      = useAppStore((s) => s.queryResult)
  const hoveredRowId     = useAppStore((s) => s.hoveredRowId)
  const selectedRowId    = useAppStore((s) => s.selectedRowId)
  const visibleColumns   = useAppStore((s) => s.visibleColumns)
  const setHoveredRowId  = useAppStore((s) => s.setHoveredRowId)
  const setSelectedRowId = useAppStore((s) => s.setSelectedRowId)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const rawRows = queryResult?.rows ?? []

  useEffect(() => {
    setSortCol(null)
    setSortDir('asc')
  }, [queryResult])

  const rows = useMemo(() => {
    if (!sortCol) return rawRows
    return [...rawRows].sort((a, b) => {
      const av = a[sortCol]
      const bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawRows, sortCol, sortDir])

  const handleHeaderClick = useCallback((colName: string) => {
    setSortCol((prev) => {
      if (prev !== colName) { setSortDir('asc'); return colName }
      setSortDir((d) => {
        if (d === 'asc') return 'desc'
        setSortCol(null)
        return 'asc'
      })
      return colName
    })
  }, [])

  const columns = useMemo(() => {
    if (!queryResult) return []
    return queryResult.columns
      .filter((name) => name !== '__row_id')
      .filter((name) => !visibleColumns || visibleColumns.includes(name))
      .map((name) => ({
        name,
        type: schema?.find((c) => c.name === name)?.type ?? '',
      }))
  }, [queryResult, schema, visibleColumns])

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

  useEffect(() => {
    if (selectedRowId == null) return
    const idx = rows.findIndex((r) => Number(r.__row_id) === selectedRowId)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'center' })
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
      <div className="flex-1 flex items-center justify-center bg-[#fffbf2] dark:bg-[#0e171e]">
        <p className="text-sm text-[#a8977a] dark:text-[#485868] select-none">
          Run a query to see results
        </p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-[#fffbf2] dark:bg-[#0e171e]">
        <div className="px-3 py-1.5 border-b border-[#d4c5a9] dark:border-[#253545] bg-[#f8f4ec] dark:bg-[#131e28] flex-shrink-0">
          <span className="text-xs text-[#a8977a] dark:text-[#485868]">0 rows returned</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[#a8977a] dark:text-[#485868] select-none">No rows matched</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#0e171e]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#d4c5a9] dark:border-[#253545] flex-shrink-0 bg-[#f8f4ec] dark:bg-[#131e28]">
        <span className="text-xs font-mono tabular-nums text-[#6b5e4a] dark:text-[#8a98a8]">
          {rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Scrollable table */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: `${totalWidth}px` }}>

          {/* Sticky header */}
          <div
            className="flex sticky top-0 z-10 bg-[#f8f4ec] dark:bg-[#131e28] border-b-2 border-[#b8a88a] dark:border-[#2f4258]"
            style={{ minWidth: `${totalWidth}px` }}
          >
            {columns.map((col) => {
              const w        = getWidth(col.name)
              const isNum    = isNumericType(col.type)
              const isSorted = sortCol === col.name
              return (
                <div
                  key={col.name}
                  style={{ width: w, minWidth: w, maxWidth: w }}
                  className="relative flex items-center group border-r border-[#e8dfc8] dark:border-[#1e2e3c] last:border-r-0 flex-shrink-0"
                >
                  <button
                    onClick={() => handleHeaderClick(col.name)}
                    className={`flex-1 flex items-center gap-1 px-2 py-2 overflow-hidden text-left w-full hover:bg-[#f2ece0] dark:hover:bg-[#192430] transition-colors ${isNum ? 'flex-row-reverse' : ''}`}
                  >
                    <span className={`text-[10px] font-bold uppercase tracking-wide truncate ${isSorted ? 'text-[#b45309] dark:text-[#fbbf24]' : 'text-[#a8977a] dark:text-[#485868]'}`}>
                      {col.name}
                    </span>
                    {isSorted ? (
                      <svg viewBox="0 0 10 12" className="w-2.5 h-3 flex-shrink-0 text-[#b45309] dark:text-[#fbbf24]" fill="currentColor">
                        {sortDir === 'asc'
                          ? <path d="M5 1 L9 6 H6 V11 H4 V6 H1 Z" />
                          : <path d="M5 11 L1 6 H4 V1 H6 V6 H9 Z" />}
                      </svg>
                    ) : (
                      <svg viewBox="0 0 10 12" className="w-2.5 h-3 flex-shrink-0 text-[#d4c5a9] dark:text-[#253545] opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor">
                        <path d="M5 1 L9 6 H6 V11 H4 V6 H1 Z" />
                      </svg>
                    )}
                  </button>
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => { e.preventDefault(); startResize(col.name, e.clientX) }}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 bg-[#b45309] dark:bg-[#fbbf24] transition-opacity z-10"
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
                  className={`flex border-b cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#fde68a] dark:bg-[#2d1c04] border-[#d4c5a9] dark:border-[#253545]'
                      : isHovered
                      ? 'bg-[#fef3c7] dark:bg-[#2d1c04]/60 border-[#e8dfc8] dark:border-[#1e2e3c]'
                      : isEven
                      ? 'bg-white dark:bg-[#0e171e] border-[#f2ece0] dark:border-[#192430]'
                      : 'bg-[#fdf9f4] dark:bg-[#101820] border-[#f2ece0] dark:border-[#192430]'
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
                        className="border-r border-[#f2ece0] dark:border-[#192430] last:border-r-0 flex-shrink-0 overflow-hidden"
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
