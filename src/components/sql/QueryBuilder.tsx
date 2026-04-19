import { useState, useEffect, useRef } from 'react'
import type { ColumnInfo } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

const EXCLUDED_TYPES = new Set(['BLOB', 'GEOMETRY'])

type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL'
type AggFn    = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
type SortDir  = 'ASC' | 'DESC'

interface FilterRow { id: string; col: string; op: FilterOp; value: string }
interface SortRow   { id: string; col: string; dir: SortDir }
interface AggRow    { id: string; fn: AggFn; col: string; alias: string }

interface BuilderState {
  mode: 'select' | 'aggregate'
  selectedCols: string[]
  filters: FilterRow[]
  sorts: SortRow[]
  limit: number
  groupByCols: string[]
  aggregates: AggRow[]
}

interface Props {
  schema: ColumnInfo[]
  initialSql: string
  onSqlChange: (sql: string) => void
  onColumnSelectionChange: (cols: string[] | null) => void
}

// ── Data helpers (unchanged) ──────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

function visibleCols(schema: ColumnInfo[]) {
  return schema.filter(
    (c) => !EXCLUDED_TYPES.has(c.type.split('(')[0].toUpperCase().trim())
  )
}

function isNumericCol(schema: ColumnInfo[], colName: string) {
  const type = schema.find((c) => c.name === colName)?.type ?? ''
  const t = type.split('(')[0].toUpperCase().trim()
  return ['INTEGER', 'INT', 'INT2', 'INT4', 'INT8', 'BIGINT', 'SMALLINT',
          'TINYINT', 'HUGEINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'REAL'].includes(t)
}

function buildSql(state: BuilderState, schema: ColumnInfo[]): string {
  const excluded = schema
    .filter((c) => EXCLUDED_TYPES.has(c.type.split('(')[0].toUpperCase().trim()))
    .map((c) => c.name)

  let selectClause: string
  if (state.mode === 'aggregate') {
    const parts = [
      ...state.groupByCols.map((c) => `"${c}"`),
      ...state.aggregates.map((a) => {
        const expr  = a.col === '*' ? '*' : `"${a.col}"`
        const alias = a.alias.trim() || `${a.fn.toLowerCase()}_${a.col === '*' ? 'count' : a.col}`
        return `${a.fn}(${expr}) AS "${alias}"`
      }),
    ]
    selectClause = parts.length ? parts.join(',\n       ') : '*'
  } else {
    selectClause = excluded.length
      ? `* EXCLUDE (${excluded.map((c) => `"${c}"`).join(', ')})`
      : '*'
  }

  const lines = [`SELECT ${selectClause}`, `FROM data`]

  const active = state.filters.filter(
    (f) => f.col && (f.op === 'IS NULL' || f.op === 'IS NOT NULL' || f.value.trim() !== '')
  )
  if (active.length) {
    const conds = active.map((f) => {
      if (f.op === 'IS NULL')     return `"${f.col}" IS NULL`
      if (f.op === 'IS NOT NULL') return `"${f.col}" IS NOT NULL`
      const numeric  = isNumericCol(schema, f.col)
      const looksNum = /^-?\d+(\.\d+)?$/.test(f.value.trim())
      const val      = numeric || looksNum ? f.value.trim() : `'${f.value.replace(/'/g, "''")}'`
      return `"${f.col}" ${f.op} ${val}`
    })
    lines.push(`WHERE ${conds.join('\n  AND ')}`)
  }

  if (state.mode === 'aggregate' && state.groupByCols.length) {
    lines.push(`GROUP BY ${state.groupByCols.map((c) => `"${c}"`).join(', ')}`)
  }

  if (state.sorts.length) {
    lines.push(`ORDER BY ${state.sorts.map((s) => `"${s.col}" ${s.dir}`).join(', ')}`)
  }

  lines.push(`LIMIT ${state.limit}`)
  return lines.join('\n')
}

function parseSqlToState(sql: string, schema: ColumnInfo[]): BuilderState {
  const dflt: BuilderState = {
    mode: 'select', selectedCols: [], filters: [], sorts: [], limit: 1000,
    groupByCols: [], aggregates: [],
  }
  try {
    const s      = sql.trim()
    const limitM = /\bLIMIT\s+(\d+)\s*$/i.exec(s)
    const limit  = limitM ? parseInt(limitM[1], 10) : 1000
    const fromM  = /^SELECT\s+([\s\S]+?)\s+FROM\s+data\b/i.exec(s)
    if (!fromM) return { ...dflt, limit }
    const selectClause = fromM[1].trim()
    const afterFrom    = s.slice(fromM[0].length).trim()
    const noLimit      = limitM
      ? afterFrom.slice(0, afterFrom.toLowerCase().lastIndexOf('limit')).trim()
      : afterFrom
    const orderM   = /\bORDER\s+BY\s+([\s\S]+?)$/i.exec(noLimit)
    const orderStr = orderM?.[1].trim() ?? ''
    const noOrder  = orderM ? noLimit.slice(0, orderM.index).trim() : noLimit
    const whereM   = /\bWHERE\s+([\s\S]+?)$/i.exec(noOrder)
    const whereStr = whereM?.[1].trim() ?? ''
    const vis      = visibleCols(schema).map((c) => c.name)
    let selectedCols: string[] = []
    if (selectClause !== '*' && !/^\*\s*EXCLUDE/i.test(selectClause)) {
      selectedCols = [...selectClause.matchAll(/"([^"]+)"/g)]
        .map((m) => m[1])
        .filter((c) => c !== '__row_id' && vis.includes(c))
    }
    const filters: FilterRow[] = []
    if (whereStr) {
      for (const cond of whereStr.split(/\bAND\b/i)) {
        const t     = cond.trim()
        const nullM = /^"([^"]+)"\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i.exec(t)
        if (nullM) { filters.push({ id: uid(), col: nullM[1], op: nullM[2].replace(/\s+/g, ' ').toUpperCase() as FilterOp, value: '' }); continue }
        const opM = /^"([^"]+)"\s*(>=|<=|!=|>|<|=|NOT LIKE|LIKE)\s*(.+)$/i.exec(t)
        if (opM && schema.some((c) => c.name === opM[1]))
          filters.push({ id: uid(), col: opM[1], op: opM[2].toUpperCase() as FilterOp, value: opM[3].trim().replace(/^'(.*)'$/s, '$1') })
      }
    }
    const sorts: SortRow[] = []
    if (orderStr) {
      for (const part of orderStr.split(',')) {
        const m = /^"([^"]+)"\s*(ASC|DESC)?$/i.exec(part.trim())
        if (m && schema.some((c) => c.name === m[1]))
          sorts.push({ id: uid(), col: m[1], dir: (m[2]?.toUpperCase() ?? 'ASC') as SortDir })
      }
    }
    return { ...dflt, selectedCols, filters, sorts, limit }
  } catch { return dflt }
}

// ── Visual helpers ────────────────────────────────────────────────────────────

function typeLabel(type: string): string {
  const t = type.split('(')[0].toUpperCase().trim()
  if (['INTEGER','INT','INT2','INT4','INT8','BIGINT','SMALLINT','TINYINT','HUGEINT','UINTEGER','UBIGINT'].includes(t)) return 'INT'
  if (['FLOAT','DOUBLE','REAL'].includes(t))   return 'FLT'
  if (['DECIMAL','NUMERIC'].includes(t))        return 'DEC'
  if (['VARCHAR','TEXT','STRING','CHAR'].includes(t)) return 'STR'
  if (t === 'DATE')                             return 'DATE'
  if (t.startsWith('TIMESTAMP'))               return 'TIME'
  if (['BOOLEAN','BOOL'].includes(t))           return 'BOOL'
  return t.slice(0, 4)
}

function typeBadgeCls(type: string): string {
  const t = type.split('(')[0].toUpperCase().trim()
  if (['INTEGER','INT','INT2','INT4','INT8','BIGINT','SMALLINT','TINYINT','HUGEINT','UINTEGER','UBIGINT'].includes(t))
    return 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400'
  if (['FLOAT','DOUBLE','DECIMAL','NUMERIC','REAL'].includes(t))
    return 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400'
  if (['VARCHAR','TEXT','STRING','CHAR'].includes(t))
    return 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
  if (['DATE','TIMESTAMP','TIME','INTERVAL'].includes(t))
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
  if (['BOOLEAN','BOOL'].includes(t))
    return 'bg-teal-100 text-teal-600 dark:bg-teal-900/50 dark:text-teal-400'
  return 'bg-[#f8f4ec] text-[#6b5e4a] dark:bg-[#131e28] dark:text-[#8a98a8]'
}

const FILTER_OPS: FilterOp[] = ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL']
const AGG_FNS: AggFn[]       = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']
const LIMIT_PRESETS           = [100, 1_000, 10_000, 100_000]

// ── Shared micro-components ───────────────────────────────────────────────────

function XBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="flex-shrink-0 text-[#d4c5a9] dark:text-[#253545] hover:text-red-400 dark:hover:text-red-400 transition-colors p-0.5"
    >
      <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2}>
        <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
      </svg>
    </button>
  )
}

function Section({
  label, icon, count, action, defaultOpen = true, children,
}: {
  label: string; icon: React.ReactNode; count?: number
  action?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-[#e8dfc8] dark:border-[#1e2e3c]">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <span className="text-[#a8977a] dark:text-[#485868] flex-shrink-0">{icon}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6b5e4a] dark:text-[#8a98a8] select-none">
            {label}
          </span>
          {count != null && count > 0 && (
            <span className="text-[10px] bg-[#fef3c7] dark:bg-[#2d1c04] text-[#b45309] dark:text-[#fbbf24] px-1.5 py-px rounded-full font-medium leading-none">
              {count}
            </span>
          )}
          <svg viewBox="0 0 16 16" fill="currentColor"
            className={`w-3 h-3 ml-auto text-[#d4c5a9] dark:text-[#253545] flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          >
            <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        </button>
        {action}
      </div>
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const ColIcon  = () => <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="1" y="1" width="12" height="12" rx="1.5"/><line x1="5" y1="1" x2="5" y2="13"/><line x1="9" y1="1" x2="9" y2="13"/></svg>
const FiltIcon = () => <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M1.5 2.5h11l-4 5v4l-3-1.5V7.5l-4-5z"/></svg>
const SortIcon = () => <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}><line x1="3" y1="2" x2="3" y2="11"/><path d="M1.5 4 3 2l1.5 2"/><line x1="11" y1="11" x2="11" y2="2"/><path d="M9.5 9 11 11l1.5-2"/><line x1="6" y1="4" x2="11" y2="4"/><line x1="6" y1="7" x2="8" y2="7"/></svg>
const LimIcon  = () => <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}><line x1="2" y1="3" x2="12" y2="3"/><line x1="2" y1="7" x2="12" y2="7"/><line x1="2" y1="11" x2="7" y2="11"/></svg>

// ── Main component ────────────────────────────────────────────────────────────

export function QueryBuilder({ schema, initialSql, onSqlChange, onColumnSelectionChange }: Props) {
  const vis        = visibleCols(schema)
  const colNames   = vis.map((c) => c.name)
  const onSqlRef   = useRef(onSqlChange)
  onSqlRef.current = onSqlChange
  const onColSelRef = useRef(onColumnSelectionChange)
  onColSelRef.current = onColumnSelectionChange

  const [state, setState]   = useState<BuilderState>(() => parseSqlToState(initialSql, schema))
  const [colSearch, setColSearch] = useState('')

  const prevSqlRef = useRef(initialSql)
  useEffect(() => {
    if (initialSql !== prevSqlRef.current) {
      prevSqlRef.current = initialSql
      setState(parseSqlToState(initialSql, schema))
    }
  }, [initialSql, schema])

  useEffect(() => {
    onSqlRef.current(buildSql(state, schema))
    const cols = state.mode === 'select' && state.selectedCols.length > 0
      ? state.selectedCols
      : null
    onColSelRef.current(cols)
  }, [state, schema])

  const update = (patch: Partial<BuilderState>) => setState((s) => ({ ...s, ...patch }))

  // SELECT
  function toggleCol(name: string) {
    const sel = state.selectedCols
    if (sel.length === 0) { update({ selectedCols: colNames.filter((c) => c !== name) }); return }
    const next = sel.includes(name) ? sel.filter((c) => c !== name) : [...sel, name]
    update({ selectedCols: next.length === colNames.length ? [] : next })
  }
  const isSelected = (name: string) => state.selectedCols.length === 0 || state.selectedCols.includes(name)
  const selCount   = state.selectedCols.length === 0 ? vis.length : state.selectedCols.length

  // Filters
  const addFilter    = () => update({ filters: [...state.filters, { id: uid(), col: colNames[0] ?? '', op: '=', value: '' }] })
  const removeFilter = (id: string) => update({ filters: state.filters.filter((f) => f.id !== id) })
  const patchFilter  = (id: string, p: Partial<FilterRow>) => update({ filters: state.filters.map((f) => f.id === id ? { ...f, ...p } : f) })

  // Sorts
  const addSort    = () => { const used = new Set(state.sorts.map((s) => s.col)); update({ sorts: [...state.sorts, { id: uid(), col: colNames.find((c) => !used.has(c)) ?? colNames[0] ?? '', dir: 'ASC' }] }) }
  const removeSort = (id: string) => update({ sorts: state.sorts.filter((s) => s.id !== id) })
  const patchSort  = (id: string, p: Partial<SortRow>) => update({ sorts: state.sorts.map((s) => s.id === id ? { ...s, ...p } : s) })

  // Aggregates
  const addAgg       = () => update({ aggregates: [...state.aggregates, { id: uid(), fn: 'COUNT', col: '*', alias: '' }] })
  const removeAgg    = (id: string) => update({ aggregates: state.aggregates.filter((a) => a.id !== id) })
  const patchAgg     = (id: string, p: Partial<AggRow>) => update({ aggregates: state.aggregates.map((a) => a.id === id ? { ...a, ...p } : a) })
  const toggleGrpCol = (col: string) => { const cur = state.groupByCols; update({ groupByCols: cur.includes(col) ? cur.filter((c) => c !== col) : [...cur, col] }) }

  const activeFilters = state.filters.filter((f) => f.col && (f.op === 'IS NULL' || f.op === 'IS NOT NULL' || f.value.trim() !== ''))

  // Shared styles for selects/inputs inside cards
  const cardSelect = 'bg-white dark:bg-[#192430] text-[11px] focus:outline-none cursor-pointer text-[#1c1208] dark:text-[#f0ebe0]'
  const addBtnCls  = 'text-[11px] text-[#b45309] dark:text-[#fbbf24] hover:text-[#92400e] dark:hover:text-[#f59e0b] transition-colors'

  return (
    <div className="h-full overflow-y-auto text-[11px]">

      {/* ── COLUMNS ─────────────────────────────────────────────────────────── */}
      <Section
        label="Columns"
        icon={<ColIcon />}
        action={
          <button
            onClick={() => update({ mode: state.mode === 'aggregate' ? 'select' : 'aggregate' })}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              state.mode === 'aggregate'
                ? 'bg-[#fef3c7] dark:bg-[#2d1c04] border-[#b45309]/30 dark:border-[#fbbf24]/30 text-[#b45309] dark:text-[#fbbf24]'
                : 'border-[#d4c5a9] dark:border-[#253545] text-[#a8977a] dark:text-[#485868] hover:border-[#b8a88a] hover:text-[#6b5e4a] dark:hover:text-[#8a98a8]'
            }`}
          >
            Σ Aggregate
          </button>
        }
      >
        {state.mode === 'select' ? (
          <div>
            {/* Search + counts */}
            <div className="px-3 pb-1.5 flex items-center gap-2">
              <div className="relative flex-1">
                <svg viewBox="0 0 14 14" className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-[#d4c5a9] dark:text-[#253545] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <circle cx="5.5" cy="5.5" r="4"/><line x1="9" y1="9" x2="13" y2="13"/>
                </svg>
                <input
                  value={colSearch}
                  onChange={(e) => setColSearch(e.target.value)}
                  placeholder="Search columns…"
                  className="w-full pl-6 pr-2 py-1 bg-[#f8f4ec] dark:bg-[#131e28] border border-[#d4c5a9] dark:border-[#253545] rounded-md text-[11px] text-[#1c1208] dark:text-[#f0ebe0] placeholder-[#a8977a] dark:placeholder-[#485868] focus:outline-none focus:ring-1 focus:ring-[#b45309] dark:focus:ring-[#fbbf24]"
                />
              </div>
              <span className="text-[10px] text-[#a8977a] dark:text-[#485868] flex-shrink-0 tabular-nums">{selCount}/{vis.length}</span>
            </div>
            {/* Column rows */}
            <div className="max-h-52 overflow-y-auto">
              {vis
                .filter((c) => !colSearch || c.name.toLowerCase().includes(colSearch.toLowerCase()))
                .map((col) => {
                  const on = isSelected(col.name)
                  return (
                    <button
                      key={col.name}
                      onClick={() => toggleCol(col.name)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors border-l-2 ${
                        on
                          ? 'bg-[#fef3c7] dark:bg-[#2d1c04]/50 border-[#b45309] dark:border-[#fbbf24]'
                          : 'border-transparent hover:bg-[#f8f4ec] dark:hover:bg-[#192430]/60'
                      }`}
                    >
                      <span className={`text-[9px] font-mono font-bold px-1 py-px rounded flex-shrink-0 ${typeBadgeCls(col.type)}`}>
                        {typeLabel(col.type)}
                      </span>
                      <span className={`flex-1 truncate text-[12px] ${on ? 'text-[#b45309] dark:text-[#fbbf24] font-medium' : 'text-[#6b5e4a] dark:text-[#8a98a8]'}`}>
                        {col.name}
                      </span>
                      {on && (
                        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-[#b45309] dark:text-[#fbbf24] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
                          <polyline points="1,5 3.5,8 9,1.5"/>
                        </svg>
                      )}
                    </button>
                  )
                })}
            </div>
            {/* All / Clear footer */}
            <div className="px-3 pt-1.5 flex items-center gap-3 border-t border-[#e8dfc8] dark:border-[#1e2e3c] mt-1">
              <button onClick={() => { update({ selectedCols: [] }); setColSearch('') }} className={addBtnCls}>Select all</button>
              <button onClick={() => update({ selectedCols: [colNames[0] ?? ''] })} className="text-[11px] text-[#a8977a] dark:text-[#485868] hover:text-[#6b5e4a] dark:hover:text-[#8a98a8] transition-colors">Clear</button>
            </div>
          </div>
        ) : (
          /* Aggregate mode */
          <div className="px-3 space-y-3">
            {/* Group By — row list */}
            <div>
              <p className="text-[10px] font-medium text-[#a8977a] dark:text-[#485868] uppercase tracking-wider mb-1">Group by</p>
              <div className="max-h-40 overflow-y-auto border border-[#e8dfc8] dark:border-[#1e2e3c] rounded-lg overflow-hidden">
                {vis.map((col) => {
                  const on = state.groupByCols.includes(col.name)
                  return (
                    <button
                      key={col.name}
                      onClick={() => toggleGrpCol(col.name)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors border-l-2 ${
                        on
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500'
                          : 'border-transparent hover:bg-[#f8f4ec] dark:hover:bg-[#192430]/60'
                      }`}
                    >
                      <span className={`text-[9px] font-mono font-bold px-1 py-px rounded flex-shrink-0 ${typeBadgeCls(col.type)}`}>
                        {typeLabel(col.type)}
                      </span>
                      <span className={`flex-1 truncate text-[12px] ${on ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-[#6b5e4a] dark:text-[#8a98a8]'}`}>
                        {col.name}
                      </span>
                      {on && (
                        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
                          <polyline points="1,5 3.5,8 9,1.5"/>
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            {/* Aggregate rows */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-[#a8977a] dark:text-[#485868] uppercase tracking-wider">Aggregate</p>
              {state.aggregates.map((a) => (
                <div key={a.id} className="flex items-center gap-1 bg-white dark:bg-[#192430] border border-[#d4c5a9] dark:border-[#253545] rounded-lg px-2 py-1.5">
                  <select value={a.fn} onChange={(e) => patchAgg(a.id, { fn: e.target.value as AggFn })}
                    className="w-16 text-[11px] font-bold text-[#b45309] dark:text-[#fbbf24] bg-white dark:bg-[#192430] focus:outline-none cursor-pointer flex-shrink-0">
                    {AGG_FNS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                  <span className="text-[#d4c5a9] dark:text-[#253545] flex-shrink-0">(</span>
                  <select value={a.col} onChange={(e) => patchAgg(a.id, { col: e.target.value })}
                    className={cardSelect + ' flex-1 min-w-0'}>
                    {a.fn === 'COUNT' && <option value="*">*</option>}
                    {vis.map((c) => <option key={c.name}>{c.name}</option>)}
                  </select>
                  <span className="text-[#d4c5a9] dark:text-[#253545] flex-shrink-0">)</span>
                  <input value={a.alias} onChange={(e) => patchAgg(a.id, { alias: e.target.value })}
                    placeholder="alias"
                    className="w-16 text-[11px] bg-transparent border-b border-[#d4c5a9] dark:border-[#253545] focus:outline-none text-[#6b5e4a] dark:text-[#8a98a8] placeholder-[#d4c5a9] dark:placeholder-[#253545] flex-shrink-0" />
                  <XBtn onClick={() => removeAgg(a.id)} />
                </div>
              ))}
              <button onClick={addAgg} className={addBtnCls}>+ Add aggregate</button>
            </div>
          </div>
        )}
      </Section>

      {/* ── FILTERS ─────────────────────────────────────────────────────────── */}
      <Section
        label="Filter"
        icon={<FiltIcon />}
        count={activeFilters.length}
        action={<button onClick={addFilter} className={addBtnCls}>+ Add</button>}
      >
        {state.filters.length === 0 ? (
          <p className="px-3 text-[11px] text-[#a8977a] dark:text-[#485868] italic">No filters — click + Add to begin</p>
        ) : (
          <div className="px-3 space-y-2">
            {state.filters.map((f) => (
              <div key={f.id} className="bg-white dark:bg-[#192430] border border-[#d4c5a9] dark:border-[#253545] rounded-lg overflow-hidden">
                {/* Row 1: column name + remove */}
                <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-[#e8dfc8] dark:border-[#1e2e3c]">
                  <select value={f.col} onChange={(e) => patchFilter(f.id, { col: e.target.value })}
                    className={cardSelect + ' flex-1 font-medium'}>
                    {colNames.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <XBtn onClick={() => removeFilter(f.id)} />
                </div>
                {/* Row 2: operator + value */}
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <select value={f.op} onChange={(e) => patchFilter(f.id, { op: e.target.value as FilterOp })}
                    className="w-24 flex-shrink-0 text-[11px] font-semibold text-[#b45309] dark:text-[#fbbf24] bg-transparent focus:outline-none cursor-pointer">
                    {FILTER_OPS.map((op) => <option key={op}>{op}</option>)}
                  </select>
                  {f.op !== 'IS NULL' && f.op !== 'IS NOT NULL' && (
                    <input value={f.value} onChange={(e) => patchFilter(f.id, { value: e.target.value })}
                      placeholder="value"
                      className="flex-1 min-w-0 text-[11px] bg-transparent border-b border-[#d4c5a9] dark:border-[#253545] focus:outline-none text-[#1c1208] dark:text-[#f0ebe0] placeholder-[#a8977a] dark:placeholder-[#485868] pb-0.5" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── ORDER BY ────────────────────────────────────────────────────────── */}
      <Section
        label="Order by"
        icon={<SortIcon />}
        count={state.sorts.length}
        action={<button onClick={addSort} className={addBtnCls}>+ Add</button>}
      >
        {state.sorts.length === 0 ? (
          <p className="px-3 text-[11px] text-[#a8977a] dark:text-[#485868] italic">No sorts — click + Add to begin</p>
        ) : (
          <div className="px-3 space-y-1.5">
            {state.sorts.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 bg-white dark:bg-[#192430] border border-[#d4c5a9] dark:border-[#253545] rounded-lg px-2.5 py-1.5">
                {/* drag-handle dots */}
                <svg viewBox="0 0 8 14" className="w-2 h-3 text-[#d4c5a9] dark:text-[#253545] flex-shrink-0" fill="currentColor">
                  <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
                  <circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/>
                  <circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/>
                </svg>
                <select value={s.col} onChange={(e) => patchSort(s.id, { col: e.target.value })}
                  className={cardSelect + ' flex-1 min-w-0'}>
                  {colNames.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button
                  onClick={() => patchSort(s.id, { dir: s.dir === 'ASC' ? 'DESC' : 'ASC' })}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 transition-colors ${
                    s.dir === 'ASC'
                      ? 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                      : 'bg-[#fef3c7] dark:bg-[#2d1c04] text-[#b45309] dark:text-[#fbbf24]'
                  }`}
                >
                  {s.dir === 'ASC' ? '↑ ASC' : '↓ DESC'}
                </button>
                <XBtn onClick={() => removeSort(s.id)} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── LIMIT ───────────────────────────────────────────────────────────── */}
      <Section label="Limit" icon={<LimIcon />}>
        <div className="px-3 space-y-2">
          {/* Presets */}
          <div className="flex gap-1.5 flex-wrap">
            {LIMIT_PRESETS.map((n) => (
              <button key={n} onClick={() => update({ limit: n })}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  state.limit === n
                    ? 'bg-[#b45309] dark:bg-[#fbbf24] text-white dark:text-[#1c1208] border-[#b45309] dark:border-[#fbbf24]'
                    : 'border-[#d4c5a9] dark:border-[#253545] text-[#6b5e4a] dark:text-[#8a98a8] hover:border-[#b45309] dark:hover:border-[#fbbf24] hover:text-[#b45309] dark:hover:text-[#fbbf24]'
                }`}
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
          {/* Custom */}
          <div className="relative">
            <input
              type="number" min={1} value={state.limit}
              onChange={(e) => { const n = parseInt(e.target.value, 10); if (n > 0) update({ limit: n }) }}
              className="w-full px-2.5 py-1.5 border border-[#d4c5a9] dark:border-[#253545] rounded-lg bg-white dark:bg-[#192430] text-[11px] text-[#1c1208] dark:text-[#f0ebe0] focus:outline-none focus:ring-1 focus:ring-[#b45309] dark:focus:ring-[#fbbf24] pr-10"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#a8977a] dark:text-[#485868] pointer-events-none select-none">rows</span>
          </div>
        </div>
      </Section>

    </div>
  )
}
