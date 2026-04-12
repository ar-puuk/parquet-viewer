import { useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'

interface Props {
  mapSlot: React.ReactNode
  tableSlot: React.ReactNode
}

export function SplitLayout({ mapSlot, tableSlot }: Props) {
  const splitRatio = useAppStore((s) => s.splitRatio)
  const setSplitRatio = useAppStore((s) => s.setSplitRatio)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // Map panel: splitRatio % of container height
  const mapPct = Math.min(100, Math.max(0, splitRatio))
  const tablePct = 100 - mapPct

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true

    const handleMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientY - rect.top) / rect.height) * 100
      setSplitRatio(Math.min(95, Math.max(5, Math.round(pct))))
    }

    const handleUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [setSplitRatio])

  // Preset buttons
  const presets = [
    { label: 'Map only', ratio: 100 },
    { label: '65 / 35', ratio: 65 },
    { label: 'Table only', ratio: 0 },
  ]

  // Suppress touch-scroll while dragging
  useEffect(() => {
    const prevent = (e: TouchEvent) => { if (isDragging.current) e.preventDefault() }
    document.addEventListener('touchmove', prevent, { passive: false })
    return () => document.removeEventListener('touchmove', prevent)
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative" ref={containerRef}>
      {/* Collapse preset buttons */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => setSplitRatio(p.ratio)}
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
              splitRatio === p.ratio
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:border-indigo-400'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Map panel */}
      {mapPct > 0 && (
        <div style={{ height: `${mapPct}%` }} className="flex-shrink-0 overflow-hidden">
          {mapSlot}
        </div>
      )}

      {/* Drag handle — only show when both panels are visible */}
      {mapPct > 0 && tablePct > 0 && (
        <div
          onMouseDown={startDrag}
          className="flex-shrink-0 h-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-indigo-400 dark:hover:bg-indigo-600 cursor-row-resize transition-colors z-10"
          title="Drag to resize"
        />
      )}

      {/* Table panel */}
      {tablePct > 0 && (
        <div style={{ height: `${tablePct}%` }} className="flex-shrink-0 overflow-hidden flex">
          {tableSlot}
        </div>
      )}
    </div>
  )
}
