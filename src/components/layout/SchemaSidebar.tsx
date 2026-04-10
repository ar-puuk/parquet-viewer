import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'

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
  INTEGER: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  BIGINT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  HUGEINT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  SMALLINT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  TINYINT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  UBIGINT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  UINTEGER: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  DOUBLE: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  FLOAT: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  DECIMAL: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  VARCHAR: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  DATE: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  TIMESTAMP: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  BOOLEAN: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  BLOB: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

function typeColor(type: string): string {
  const base = type.split('(')[0].toUpperCase()
  return TYPE_COLORS[base] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

export function SchemaSidebar() {
  const { activeFile, schema, fileStats, clearFile } = useAppStore()
  const [collapsed, setCollapsed] = useState(false)

  if (!activeFile || !schema) return null

  if (collapsed) {
    return (
      <aside className="flex flex-col items-center w-10 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 py-3 gap-3 flex-shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand schema sidebar"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Schema</span>
        <div className="flex items-center gap-1">
          <button
            onClick={clearFile}
            title="Close file"
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* File name */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={activeFile.name}>
          {activeFile.name}
        </p>
      </div>

      {/* File stats strip */}
      {fileStats && (
        <div className="grid grid-cols-2 gap-px bg-gray-200 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-800">
          {[
            { label: 'Rows', value: formatNumber(fileStats.rowCount) },
            { label: 'Columns', value: formatNumber(fileStats.columnCount) },
            { label: 'Size', value: formatBytes(fileStats.fileSizeBytes) },
            { label: 'Row groups', value: formatNumber(fileStats.rowGroupCount) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 dark:bg-gray-900 px-3 py-2">
              <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Parquet version / writer */}
      {fileStats?.createdBy && (
        <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-800">
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate" title={fileStats.createdBy}>
            Written by: {fileStats.createdBy}
          </p>
        </div>
      )}

      {/* Column list */}
      <div className="flex-1 overflow-y-auto">
        <ul>
          {schema.map((col) => (
            <li
              key={col.name}
              className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate" title={col.name}>
                  {col.name}
                </p>
                <span className={`inline-block mt-0.5 text-[10px] font-mono px-1 rounded ${typeColor(col.type)}`}>
                  {col.type}
                </span>
              </div>
              {col.nullable && (
                <span className="flex-shrink-0 text-[10px] text-gray-400 dark:text-gray-500" title="Nullable">
                  null
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
