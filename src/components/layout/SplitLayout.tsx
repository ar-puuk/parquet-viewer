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

  const presets = [
    { label: 'Map only', ratio: 100 },
    { label: '65 / 35', ratio: 65 },
    { label: 'Table only', ratio: 0 },
  ]

  useEffect(() => {
    const prevent = (e: TouchEvent) => { if (isDragging.current) e.preventDefault() }
    document.addEventListener('touchmove', prevent, { passive: false })
    return () => document.removeEventListener('touchmove', prevent)
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative" ref={containerRef}>
      {/* Preset toolbar — floating pill */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex gap-0.5 p-1 bg-white/90 dark:bg-[#131e28]/90 backdrop-blur-sm rounded-lg border border-[#d4c5a9]/60 dark:border-[#253545] shadow-[0_2px_8px_rgba(0,0,0,0.10)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => setSplitRatio(p.ratio)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-md border transition-colors duration-150 ${
              splitRatio === p.ratio
                ? 'bg-[#b45309] dark:bg-[#fbbf24] text-white dark:text-[#1c1208] border-[#b45309] dark:border-[#fbbf24]'
                : 'bg-transparent text-[#6b5e4a] dark:text-[#8a98a8] border-transparent hover:bg-[#f2ece0] dark:hover:bg-[#253545] hover:text-[#1c1208] dark:hover:text-[#f0ebe0]'
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

      {/* Drag handle */}
      {mapPct > 0 && tablePct > 0 && (
        <div
          onMouseDown={startDrag}
          className="group flex-shrink-0 h-[5px] bg-[#d4c5a9] dark:bg-[#253545] hover:bg-[#b45309] dark:hover:bg-[#fbbf24] cursor-row-resize transition-colors duration-150 z-10 relative"
          title="Drag to resize"
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-white dark:bg-[#1c1208]" />
            ))}
          </div>
        </div>
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
