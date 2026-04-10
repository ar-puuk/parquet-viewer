import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { SqlEditor } from './SqlEditor'
import { useAppStore } from '../../store/useAppStore'
import { useSqlQuery } from '../../hooks/useSqlQuery'

const EXCLUDED_TYPES = new Set(['BLOB', 'GEOMETRY'])

function buildDefaultSql(schema: { name: string; type: string }[] | null): string {
  if (!schema) return 'SELECT *\nFROM data\nLIMIT 1000'
  const excludedCols = schema
    .filter((c) => EXCLUDED_TYPES.has(c.type.split('(')[0].toUpperCase().trim()))
    .map((c) => `"${c.name}"`)
  if (excludedCols.length === 0) return 'SELECT *\nFROM data\nLIMIT 1000'
  return `SELECT * EXCLUDE (${excludedCols.join(', ')})\nFROM data\nLIMIT 1000`
}

export function SqlPanel() {
  const schema      = useAppStore((s) => s.schema)
  const queryResult = useAppStore((s) => s.queryResult)
  const theme       = useAppStore((s) => s.theme)
  const { runQuery, isRunning, error, clearError } = useSqlQuery()

  const isDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const defaultSql = useMemo(() => buildDefaultSql(schema), [schema])

  const [sql, setSql]       = useState(defaultSql)
  const [isOpen, setIsOpen] = useState(true)

  // Track whether we've auto-run for the current file to avoid running twice
  const autoRanRef = useRef(false)

  // When a new file is loaded (schema changes), reset editor + auto-run default query
  useEffect(() => {
    if (!schema) return
    const fresh = buildDefaultSql(schema)
    setSql(fresh)
    setIsOpen(true)
    autoRanRef.current = false
  }, [schema])

  // Auto-run the default query once schema + DuckDB are ready
  useEffect(() => {
    if (!schema || autoRanRef.current) return
    autoRanRef.current = true
    runQuery(buildDefaultSql(schema))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema])

  const handleRun = useCallback(() => {
    if (!sql.trim() || isRunning) return
    clearError()
    runQuery(sql)
  }, [sql, isRunning, runQuery, clearError])

  // ── Collapsed bar (shown after first run) ────────────────────────────────
  if (!isOpen && queryResult) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex-shrink-0 min-w-0">
        <code className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate flex-1 min-w-0">
          {queryResult.sql.replace(/\s+/g, ' ')}
        </code>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap">
          {queryResult.rows.length.toLocaleString()} rows · {queryResult.executionMs}ms
        </span>
        <button
          onClick={() => setIsOpen(true)}
          className="text-[11px] font-medium text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex-shrink-0"
        >
          Edit
        </button>
      </div>
    )
  }

  // ── Expanded panel ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 select-none">
          SQL
        </span>
        <div className="flex items-center gap-3">
          {queryResult && !isRunning && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {queryResult.rows.length.toLocaleString()} rows · {queryResult.executionMs}ms
            </span>
          )}
          {queryResult && (
            <button
              onClick={() => setIsOpen(false)}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Collapse
            </button>
          )}
        </div>
      </div>

      {/* CodeMirror editor */}
      <div className="h-[120px] overflow-hidden">
        <SqlEditor value={sql} onChange={setSql} onRun={handleRun} isDark={isDark} />
      </div>

      {/* Footer: run button */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={handleRun}
          disabled={isRunning || !sql.trim()}
          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
        >
          {isRunning ? (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
          ) : (
            <span className="text-[10px]">▶</span>
          )}
          Run
        </button>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 select-none">
          Ctrl+Enter
        </span>
      </div>

      {/* Inline error */}
      {error && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-[11px] font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">
          {error}
        </div>
      )}
    </div>
  )
}
