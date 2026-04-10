import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { SqlEditor } from './SqlEditor'
import { QueryBuilder } from './QueryBuilder'
import { useAppStore } from '../../store/useAppStore'
import { useSqlQuery } from '../../hooks/useSqlQuery'

const EXCLUDED_TYPES  = new Set(['BLOB', 'GEOMETRY'])
const HISTORY_KEY     = 'sqlHistory'
const MAX_HISTORY     = 20
const MIN_PANEL_WIDTH = 200
const MAX_PANEL_WIDTH = 600
const DEFAULT_WIDTH   = 288

function buildDefaultSql(schema: { name: string; type: string }[] | null): string {
  if (!schema) return 'SELECT *\nFROM data\nLIMIT 1000'
  const excludedCols = schema
    .filter((c) => EXCLUDED_TYPES.has(c.type.split('(')[0].toUpperCase().trim()))
    .map((c) => `"${c.name}"`)
  if (excludedCols.length === 0) return 'SELECT *\nFROM data\nLIMIT 1000'
  return `SELECT * EXCLUDE (${excludedCols.join(', ')})\nFROM data\nLIMIT 1000`
}

function loadHistory(): string[] {
  try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '[]') }
  catch { return [] }
}

function saveHistory(history: string[]) {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)) }
  catch {}
}

export function SqlPanel() {
  const schema      = useAppStore((s) => s.schema)
  const queryResult = useAppStore((s) => s.queryResult)
  const theme       = useAppStore((s) => s.theme)
  const { runQuery, isRunning, error, clearError } = useSqlQuery()

  const isDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const defaultSql = useMemo(() => buildDefaultSql(schema), [schema])

  const [sql, setSql]             = useState(defaultSql)
  const [activeTab, setActiveTab] = useState<'sql' | 'builder'>('builder')
  const [expanded, setExpanded]   = useState(true)
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const stored = parseInt(localStorage.getItem('sqlPanelWidth') ?? '', 10)
    return isNaN(stored) ? DEFAULT_WIDTH : Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, stored))
  })
  const dragStartRef = useRef<{ x: number; width: number } | null>(null)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, width: panelWidth }
    function onMouseMove(ev: MouseEvent) {
      if (!dragStartRef.current) return
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH,
        dragStartRef.current.width + ev.clientX - dragStartRef.current.x))
      setPanelWidth(next)
      localStorage.setItem('sqlPanelWidth', String(Math.round(next)))
    }
    function onMouseUp() {
      dragStartRef.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [panelWidth])

  // Builder gets its own snapshot of SQL on every tab switch to 'builder'
  const [builderKey, setBuilderKey]         = useState(0)
  const [builderInitialSql, setBuilderInitialSql] = useState(sql)

  const autoRanRef      = useRef(false)
  const historyRef      = useRef<string[]>(loadHistory())
  const historyIndexRef = useRef<number>(-1)

  // When a new file is loaded reset state and auto-run default query
  useEffect(() => {
    if (!schema) return
    const fresh = buildDefaultSql(schema)
    setSql(fresh)
    setActiveTab('builder')
    setExpanded(true)
    autoRanRef.current    = false
    historyIndexRef.current = -1
  }, [schema])

  useEffect(() => {
    if (!schema || autoRanRef.current) return
    autoRanRef.current = true
    runQuery(buildDefaultSql(schema))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema])

  const handleTabChange = useCallback((tab: 'sql' | 'builder') => {
    if (tab === 'builder') {
      setBuilderInitialSql(sql)
      setBuilderKey((k) => k + 1)
    }
    setActiveTab(tab)
  }, [sql])

  const handleRun = useCallback(() => {
    if (!sql.trim() || isRunning) return
    clearError()
    const trimmed = sql.trim()
    const hist = historyRef.current.filter((q) => q !== trimmed)
    hist.unshift(trimmed)
    if (hist.length > MAX_HISTORY) hist.length = MAX_HISTORY
    historyRef.current = hist
    saveHistory(hist)
    historyIndexRef.current = -1
    runQuery(sql)
  }, [sql, isRunning, runQuery, clearError])

  const handleHistoryUp = useCallback(() => {
    const hist = historyRef.current
    if (hist.length === 0) return
    const next = Math.min(historyIndexRef.current + 1, hist.length - 1)
    historyIndexRef.current = next
    setSql(hist[next])
  }, [])

  const handleHistoryDown = useCallback(() => {
    const hist = historyRef.current
    const next = historyIndexRef.current - 1
    if (next < 0) {
      historyIndexRef.current = -1
      setSql(defaultSql)
    } else {
      historyIndexRef.current = next
      setSql(hist[next])
    }
  }, [defaultSql])

  // ── Collapsed icon bar ────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <aside className="flex flex-col items-center w-10 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 py-3 gap-3 flex-shrink-0">
        <button
          onClick={() => setExpanded(true)}
          title="Expand SQL panel"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
        {/* Rotated label */}
        <span
          className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 select-none"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          SQL
        </span>
      </aside>
    )
  }

  // ── Expanded sidebar ──────────────────────────────────────────────────────
  return (
    <aside
      style={{ width: panelWidth }}
      className="flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col overflow-hidden relative"
    >

      {/* Header: tabs + collapse */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-0.5 bg-gray-200 dark:bg-gray-700 rounded p-0.5">
          {(['sql', 'builder'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <button
          onClick={() => setExpanded(false)}
          title="Collapse SQL panel"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Content: SQL editor or Builder (flex-1 so it fills remaining height) */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'sql' ? (
          <SqlEditor
            value={sql}
            onChange={setSql}
            onRun={handleRun}
            isDark={isDark}
            schema={schema}
            onHistoryUp={handleHistoryUp}
            onHistoryDown={handleHistoryDown}
          />
        ) : schema ? (
          <QueryBuilder
            key={builderKey}
            schema={schema}
            initialSql={builderInitialSql}
            onSqlChange={setSql}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-gray-400 dark:text-gray-600 p-4 text-center">
            Load a file to use the query builder
          </div>
        )}
      </div>

      {/* Footer: run button + stats + copy */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            onClick={handleRun}
            disabled={isRunning || !sql.trim()}
            className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors flex-shrink-0"
          >
            {isRunning ? (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 10 10" className="w-3 h-3" fill="currentColor">
              <path d="M2 1.5 L9 5 L2 8.5 Z"/>
            </svg>
            )}
            Run
          </button>

          {queryResult && !isRunning ? (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              {queryResult.rows.length.toLocaleString()} rows · {queryResult.executionMs}ms
            </span>
          ) : (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 select-none">
              Ctrl+Enter
            </span>
          )}

          <button
            onClick={() => navigator.clipboard.writeText(sql).catch(() => {})}
            title="Copy SQL"
            className="ml-auto flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
          >
            <svg viewBox="0 0 14 14" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="4" y="4" width="8" height="9" rx="1" />
              <path d="M10 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1" />
            </svg>
            Copy
          </button>
        </div>

        {/* Inline error */}
        {error && (
          <div className="mx-3 mb-2 px-2 py-1.5 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-[11px] font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">
            {error}
          </div>
        )}
      </div>

      {/* Right-edge resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-indigo-400 dark:hover:bg-indigo-600 transition-colors z-10"
        title="Drag to resize"
      />
    </aside>
  )
}
