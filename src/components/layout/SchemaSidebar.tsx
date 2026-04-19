import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useColumnStats } from '../../hooks/useColumnStats'

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

const TYPE_COLORS: Record<string, string> = {
  INTEGER:   'bg-[#dbeafe] text-[#1e40af] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  BIGINT:    'bg-[#dbeafe] text-[#1e40af] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  HUGEINT:   'bg-[#dbeafe] text-[#1e40af] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  SMALLINT:  'bg-[#dbeafe] text-[#1e40af] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  TINYINT:   'bg-[#dbeafe] text-[#1e40af] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  UBIGINT:   'bg-[#dbeafe] text-[#1e40af] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  UINTEGER:  'bg-[#dbeafe] text-[#1e40af] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  DOUBLE:    'bg-[#ede9fe] text-[#5b21b6] dark:bg-[#2e1a5c] dark:text-[#c4b5fd]',
  FLOAT:     'bg-[#ede9fe] text-[#5b21b6] dark:bg-[#2e1a5c] dark:text-[#c4b5fd]',
  DECIMAL:   'bg-[#ede9fe] text-[#5b21b6] dark:bg-[#2e1a5c] dark:text-[#c4b5fd]',
  VARCHAR:   'bg-[#d1fae5] text-[#065f46] dark:bg-[#052e16] dark:text-[#6ee7b7]',
  DATE:      'bg-[#fef3c7] text-[#92400e] dark:bg-[#2d1c04] dark:text-[#fcd34d]',
  TIMESTAMP: 'bg-[#fef3c7] text-[#92400e] dark:bg-[#2d1c04] dark:text-[#fcd34d]',
  BOOLEAN:   'bg-[#ccfbf1] text-[#0f766e] dark:bg-[#042f2e] dark:text-[#5eead4]',
  BLOB:      'bg-[#f1f5f9] text-[#64748b] dark:bg-[#1e293b] dark:text-[#94a3b8]',
}

function typeColor(type: string): string {
  const base = type.split('(')[0].toUpperCase()
  return TYPE_COLORS[base] ?? 'bg-[#f8f4ec] text-[#6b5e4a] dark:bg-[#131e28] dark:text-[#8a98a8]'
}

export function SchemaSidebar() {
  const { activeFile, schema, fileStats, clearFile } = useAppStore()
  const [collapsed, setCollapsed] = useState(false)
  const [selectedCol, setSelectedCol] = useState<string | null>(null)
  const { stats, loading: statsLoading, error: statsError, loadStats, clearStats } = useColumnStats()

  if (!activeFile || !schema) return null

  function handleColClick(colName: string, colType: string) {
    if (selectedCol === colName) {
      setSelectedCol(null)
      clearStats()
    } else {
      setSelectedCol(colName)
      loadStats(colName, colType)
    }
  }

  if (collapsed) {
    return (
      <aside className="flex flex-col items-center w-10 border-l border-[#d4c5a9] dark:border-[#253545] bg-[#f2ece0] dark:bg-[#131e28] py-3 gap-3 flex-shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand schema sidebar"
          className="p-1 rounded hover:bg-[#d4c5a9] dark:hover:bg-[#253545] text-[#a8977a] dark:text-[#485868] hover:text-[#6b5e4a] dark:hover:text-[#8a98a8] transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-64 flex-shrink-0 border-l border-[#d4c5a9] dark:border-[#253545] bg-[#f2ece0] dark:bg-[#131e28] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#d4c5a9] dark:border-[#253545] flex-shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#a8977a] dark:text-[#485868]">Schema</span>
        <div className="flex items-center gap-1">
          <button
            onClick={clearFile}
            title="Close file"
            className="p-1 rounded hover:bg-[#d4c5a9] dark:hover:bg-[#253545] text-[#a8977a] dark:text-[#485868] hover:text-[#6b5e4a] dark:hover:text-[#8a98a8] transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            className="p-1 rounded hover:bg-[#d4c5a9] dark:hover:bg-[#253545] text-[#a8977a] dark:text-[#485868] hover:text-[#6b5e4a] dark:hover:text-[#8a98a8] transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* File name */}
      <div className="px-3 py-2 border-b border-[#d4c5a9] dark:border-[#253545] bg-white dark:bg-[#192430] flex-shrink-0">
        <p className="text-[11px] font-mono text-[#6b5e4a] dark:text-[#8a98a8] truncate" title={activeFile.name}>
          {activeFile.name}
        </p>
      </div>

      {/* File stats grid */}
      {fileStats && (
        <div className="grid grid-cols-2 gap-px bg-[#d4c5a9] dark:bg-[#253545] border-b border-[#d4c5a9] dark:border-[#253545] flex-shrink-0">
          {[
            { label: 'Rows', value: formatNumber(fileStats.rowCount) },
            { label: 'Columns', value: formatNumber(fileStats.columnCount) },
            { label: 'Size', value: formatBytes(fileStats.fileSizeBytes) },
            { label: 'Row groups', value: formatNumber(fileStats.rowGroupCount) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#f8f4ec] dark:bg-[#131e28] px-3 py-2.5">
              <p className="text-[10px] font-medium text-[#a8977a] dark:text-[#485868] uppercase tracking-wide">{label}</p>
              <p className="text-sm font-semibold font-mono tabular-nums text-[#1c1208] dark:text-[#f0ebe0] truncate">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Parquet writer */}
      {fileStats?.createdBy && (
        <div className="px-3 py-1.5 border-b border-[#d4c5a9] dark:border-[#253545] bg-white dark:bg-[#192430] flex-shrink-0">
          <p className="text-[10px] font-mono text-[#a8977a] dark:text-[#485868] truncate" title={fileStats.createdBy}>
            {fileStats.createdBy}
          </p>
        </div>
      )}

      {/* Column list */}
      <div className="flex-1 overflow-y-auto">
        <ul>
          {schema.map((col) => {
            const isSelected = selectedCol === col.name
            return (
              <li key={col.name} className="border-b border-[#e8dfc8] dark:border-[#1e2e3c]">
                <button
                  onClick={() => handleColClick(col.name, col.type)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-[#fef3c7] dark:bg-[#2d1c04]'
                      : 'hover:bg-white dark:hover:bg-[#192430]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs font-medium truncate ${
                        isSelected
                          ? 'text-[#b45309] dark:text-[#fbbf24]'
                          : 'text-[#1c1208] dark:text-[#f0ebe0]'
                      }`}
                      title={col.name}
                    >
                      {col.name}
                    </p>
                    <span className={`inline-block mt-0.5 text-[10px] font-mono px-1 rounded ${typeColor(col.type)}`}>
                      {col.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {col.nullable && (
                      <span className="text-[10px] text-[#a8977a] dark:text-[#485868]" title="Nullable">
                        null
                      </span>
                    )}
                    <svg
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className={`w-3 h-3 text-[#a8977a] dark:text-[#485868] transition-transform ${isSelected ? 'rotate-180' : ''}`}
                    >
                      <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                    </svg>
                  </div>
                </button>

                {/* Inline stats panel */}
                {isSelected && (
                  <div className="px-3 py-3 bg-white dark:bg-[#192430] border-t border-[#e8dfc8] dark:border-[#1e2e3c] fade-in">
                    {statsLoading && (
                      <div className="flex items-center gap-1.5 text-xs text-[#a8977a] dark:text-[#485868] py-1">
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Computing stats…
                      </div>
                    )}
                    {statsError && (
                      <p className="text-xs text-red-500 dark:text-red-400">{statsError}</p>
                    )}
                    {stats && !statsLoading && (
                      <div className="space-y-1.5">
                        {stats.minVal !== null && <StatRow label="Min" value={stats.minVal} />}
                        {stats.maxVal !== null && <StatRow label="Max" value={stats.maxVal} />}
                        <StatRow label="Distinct" value={stats.distinctCount.toLocaleString()} />
                        <div>
                          <div className="flex justify-between text-[10px] text-[#a8977a] dark:text-[#485868] mb-0.5">
                            <span>Nulls</span>
                            <span>
                              {stats.nullCount.toLocaleString()}
                              {' '}
                              ({stats.totalSampled > 0
                                ? ((stats.nullCount / stats.totalSampled) * 100).toFixed(1)
                                : 0}%)
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-[#e8dfc8] dark:bg-[#253545] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 dark:bg-amber-500 rounded-full"
                              style={{
                                width: `${stats.totalSampled > 0 ? (stats.nullCount / stats.totalSampled) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-[#a8977a] dark:text-[#485868]">
                          Sampled {stats.totalSampled.toLocaleString()} rows
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-[10px] text-[#a8977a] dark:text-[#485868] flex-shrink-0">{label}</span>
      <span className="text-[10px] font-mono text-[#1c1208] dark:text-[#f0ebe0] truncate text-right" title={value}>
        {value}
      </span>
    </div>
  )
}
