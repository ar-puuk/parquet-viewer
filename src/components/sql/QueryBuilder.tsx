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
  selectedCols: string[]    // empty = all visible columns
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const vis = visibleCols(schema)
  const excluded = schema
    .filter((c) => EXCLUDED_TYPES.has(c.type.split('(')[0].toUpperCase().trim()))
    .map((c) => c.name)

  // ── SELECT clause ──────────────────────────────────────────────────────────
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
    const sel     = state.selectedCols
    const allCols = vis.map((c) => c.name)
    const isAll   = sel.length === 0 || (sel.length === allCols.length && allCols.every((c) => sel.includes(c)))
    if (isAll) {
      selectClause = excluded.length
        ? `* EXCLUDE (${excluded.map((c) => `"${c}"`).join(', ')})`
        : '*'
    } else {
      selectClause = sel.map((c) => `"${c}"`).join(',\n       ')
    }
  }

  const lines = [`SELECT ${selectClause}`, `FROM data`]

  // ── WHERE ──────────────────────────────────────────────────────────────────
  const active = state.filters.filter(
    (f) => f.col && (f.op === 'IS NULL' || f.op === 'IS NOT NULL' || f.value.trim() !== '')
  )
  if (active.length) {
    const conds = active.map((f) => {
      if (f.op === 'IS NULL')     return `"${f.col}" IS NULL`
      if (f.op === 'IS NOT NULL') return `"${f.col}" IS NOT NULL`
      const numeric   = isNumericCol(schema, f.col)
      const looksNum  = /^-?\d+(\.\d+)?$/.test(f.value.trim())
      const quotedVal = numeric || looksNum
        ? f.value.trim()
        : `'${f.value.replace(/'/g, "''")}'`
      return `"${f.col}" ${f.op} ${quotedVal}`
    })
    lines.push(`WHERE ${conds.join('\n  AND ')}`)
  }

  // ── GROUP BY ───────────────────────────────────────────────────────────────
  if (state.mode === 'aggregate' && state.groupByCols.length) {
    lines.push(`GROUP BY ${state.groupByCols.map((c) => `"${c}"`).join(', ')}`)
  }

  // ── ORDER BY ───────────────────────────────────────────────────────────────
  if (state.sorts.length) {
    lines.push(`ORDER BY ${state.sorts.map((s) => `"${s.col}" ${s.dir}`).join(', ')}`)
  }

  // ── LIMIT ──────────────────────────────────────────────────────────────────
  lines.push(`LIMIT ${state.limit}`)
  return lines.join('\n')
}

function parseSqlToState(sql: string, schema: ColumnInfo[]): BuilderState {
  const dflt: BuilderState = {
    mode: 'select', selectedCols: [], filters: [], sorts: [], limit: 1000,
    groupByCols: [], aggregates: [],
  }
  try {
    const s = sql.trim()

    // LIMIT
    const limitM = /\bLIMIT\s+(\d+)\s*$/i.exec(s)
    const limit  = limitM ? parseInt(limitM[1], 10) : 1000

    // SELECT ... FROM data
    const fromM = /^SELECT\s+([\s\S]+?)\s+FROM\s+data\b/i.exec(s)
    if (!fromM) return { ...dflt, limit }
    const selectClause = fromM[1].trim()
    const afterFrom    = s.slice(fromM[0].length).trim()

    // Strip LIMIT from afterFrom for further parsing
    const noLimit = limitM
      ? afterFrom.slice(0, afterFrom.toLowerCase().lastIndexOf('limit')).trim()
      : afterFrom

    // ORDER BY
    const orderM  = /\bORDER\s+BY\s+([\s\S]+?)$/i.exec(noLimit)
    const orderStr = orderM?.[1].trim() ?? ''
    const noOrder  = orderM ? noLimit.slice(0, orderM.index).trim() : noLimit

    // WHERE
    const whereM  = /\bWHERE\s+([\s\S]+?)$/i.exec(noOrder)
    const whereStr = whereM?.[1].trim() ?? ''

    // Parse columns
    const vis   = visibleCols(schema).map((c) => c.name)
    let selectedCols: string[] = []
    if (selectClause !== '*' && !/^\*\s*EXCLUDE/i.test(selectClause)) {
      const matches = [...selectClause.matchAll(/"([^"]+)"/g)]
      selectedCols = matches
        .map((m) => m[1])
        .filter((c) => c !== '__row_id' && vis.includes(c))
    }

    // Parse filters (simple col OP val AND ...)
    const filters: FilterRow[] = []
    if (whereStr) {
      for (const cond of whereStr.split(/\bAND\b/i)) {
        const t     = cond.trim()
        const nullM = /^"([^"]+)"\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i.exec(t)
        if (nullM) {
          filters.push({ id: uid(), col: nullM[1], op: nullM[2].replace(/\s+/g, ' ').toUpperCase() as FilterOp, value: '' })
          continue
        }
        const opM = /^"([^"]+)"\s*(>=|<=|!=|>|<|=|NOT LIKE|LIKE)\s*(.+)$/i.exec(t)
        if (opM && schema.some((c) => c.name === opM[1])) {
          filters.push({
            id: uid(), col: opM[1],
            op: opM[2].toUpperCase() as FilterOp,
            value: opM[3].trim().replace(/^'(.*)'$/s, '$1'),
          })
        }
      }
    }

    // Parse sorts
    const sorts: SortRow[] = []
    if (orderStr) {
      for (const part of orderStr.split(',')) {
        const m = /^"([^"]+)"\s*(ASC|DESC)?$/i.exec(part.trim())
        if (m && schema.some((c) => c.name === m[1])) {
          sorts.push({ id: uid(), col: m[1], dir: (m[2]?.toUpperCase() ?? 'ASC') as SortDir })
        }
      }
    }

    return { ...dflt, selectedCols, filters, sorts, limit }
  } catch {
    return dflt
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

const FILTER_OPS: FilterOp[] = ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL']
const AGG_FNS: AggFn[]       = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']

const inputCls = 'w-full px-1.5 py-0.5 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400'
const selectCls = inputCls + ' cursor-pointer'
const sectionLabel = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 select-none'
const iconBtn = 'p-0.5 text-gray-400 hover:text-red-400 transition-colors'
const addBtn = 'text-[11px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors'

// ── Main component ────────────────────────────────────────────────────────────

export function QueryBuilder({ schema, initialSql, onSqlChange }: Props) {
  const vis        = visibleCols(schema)
  const colNames   = vis.map((c) => c.name)
  const onSqlRef   = useRef(onSqlChange)
  onSqlRef.current = onSqlChange

  const [state, setState] = useState<BuilderState>(() => parseSqlToState(initialSql, schema))

  // Re-parse when mounted with new SQL (tab switch)
  const prevSqlRef = useRef(initialSql)
  useEffect(() => {
    if (initialSql !== prevSqlRef.current) {
      prevSqlRef.current = initialSql
      setState(parseSqlToState(initialSql, schema))
    }
  }, [initialSql, schema])

  // Emit SQL whenever state changes
  useEffect(() => {
    onSqlRef.current(buildSql(state, schema))
  }, [state, schema])

  const update = (patch: Partial<BuilderState>) =>
    setState((s) => ({ ...s, ...patch }))

  // ── SELECT toggles ──────────────────────────────────────────────────────────
  function toggleCol(name: string) {
    const sel = state.selectedCols
    if (sel.length === 0) {
      // currently "all" — deselect this one
      update({ selectedCols: colNames.filter((c) => c !== name) })
    } else if (sel.includes(name)) {
      const next = sel.filter((c) => c !== name)
      update({ selectedCols: next })
    } else {
      const next = [...sel, name]
      // If all selected, collapse back to "all"
      update({ selectedCols: next.length === colNames.length ? [] : next })
    }
  }

  function isColChecked(name: string) {
    return state.selectedCols.length === 0 || state.selectedCols.includes(name)
  }

  // ── Filters ─────────────────────────────────────────────────────────────────
  function addFilter() {
    update({
      filters: [...state.filters, { id: uid(), col: colNames[0] ?? '', op: '=', value: '' }],
    })
  }
  function removeFilter(id: string) {
    update({ filters: state.filters.filter((f) => f.id !== id) })
  }
  function patchFilter(id: string, patch: Partial<FilterRow>) {
    update({ filters: state.filters.map((f) => f.id === id ? { ...f, ...patch } : f) })
  }

  // ── Sorts ────────────────────────────────────────────────────────────────────
  function addSort() {
    const used = new Set(state.sorts.map((s) => s.col))
    const next = colNames.find((c) => !used.has(c)) ?? colNames[0] ?? ''
    update({ sorts: [...state.sorts, { id: uid(), col: next, dir: 'ASC' }] })
  }
  function removeSort(id: string) {
    update({ sorts: state.sorts.filter((s) => s.id !== id) })
  }
  function patchSort(id: string, patch: Partial<SortRow>) {
    update({ sorts: state.sorts.map((s) => s.id === id ? { ...s, ...patch } : s) })
  }

  // ── Aggregates ───────────────────────────────────────────────────────────────
  function addAgg() {
    update({ aggregates: [...state.aggregates, { id: uid(), fn: 'COUNT', col: '*', alias: '' }] })
  }
  function removeAgg(id: string) {
    update({ aggregates: state.aggregates.filter((a) => a.id !== id) })
  }
  function patchAgg(id: string, patch: Partial<AggRow>) {
    update({ aggregates: state.aggregates.map((a) => a.id === id ? { ...a, ...patch } : a) })
  }
  function toggleGroupByCol(col: string) {
    const cur = state.groupByCols
    update({ groupByCols: cur.includes(col) ? cur.filter((c) => c !== col) : [...cur, col] })
  }

  const RemoveBtn = ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} className={iconBtn} title="Remove">
      <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
      </svg>
    </button>
  )

  return (
    <div className="h-full overflow-y-auto text-[11px] text-gray-700 dark:text-gray-300 divide-y divide-gray-100 dark:divide-gray-800">

      {/* ── SELECT / AGGREGATE toggle ──────────────────────────────────────── */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Select</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => update({ mode: state.mode === 'aggregate' ? 'select' : 'aggregate' })}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                state.mode === 'aggregate'
                  ? 'bg-indigo-100 dark:bg-indigo-900 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              Group &amp; Aggregate
            </button>
            {state.mode === 'select' && (
              <>
                <button onClick={() => update({ selectedCols: [] })} className={addBtn}>All</button>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <button onClick={() => update({ selectedCols: [colNames[0] ?? ''] })} className={addBtn}>None</button>
              </>
            )}
          </div>
        </div>

        {state.mode === 'select' ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
            {vis.map((col) => (
              <label key={col.name} className="flex items-center gap-1 cursor-pointer min-w-0 max-w-[45%]">
                <input
                  type="checkbox"
                  checked={isColChecked(col.name)}
                  onChange={() => toggleCol(col.name)}
                  className="accent-indigo-500 w-3 h-3 flex-shrink-0"
                />
                <span className="truncate" title={col.name}>{col.name}</span>
              </label>
            ))}
          </div>
        ) : (
          /* ── Aggregate mode ─────────────────────────────────────────────── */
          <div className="space-y-2 pt-0.5">
            {/* Group By */}
            <div>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">Group by</span>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                {vis.map((col) => (
                  <label key={col.name} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={state.groupByCols.includes(col.name)}
                      onChange={() => toggleGroupByCol(col.name)}
                      className="accent-indigo-500 w-3 h-3"
                    />
                    <span>{col.name}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Aggregates */}
            <div className="space-y-1">
              {state.aggregates.map((a) => (
                <div key={a.id} className="flex items-center gap-1">
                  <select value={a.fn} onChange={(e) => patchAgg(a.id, { fn: e.target.value as AggFn })} className={selectCls + ' w-20'}>
                    {AGG_FNS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                  <select value={a.col} onChange={(e) => patchAgg(a.id, { col: e.target.value })} className={selectCls + ' flex-1'}>
                    {a.fn === 'COUNT' && <option value="*">*</option>}
                    {vis.map((c) => <option key={c.name}>{c.name}</option>)}
                  </select>
                  <span className="text-gray-400 flex-shrink-0">as</span>
                  <input
                    value={a.alias}
                    onChange={(e) => patchAgg(a.id, { alias: e.target.value })}
                    placeholder="alias"
                    className={inputCls + ' w-20'}
                  />
                  <RemoveBtn onClick={() => removeAgg(a.id)} />
                </div>
              ))}
              <button onClick={addAgg} className={addBtn}>+ Add aggregate</button>
            </div>
          </div>
        )}
      </div>

      {/* ── WHERE ─────────────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Where</span>
          <button onClick={addFilter} className={addBtn}>+ Add filter</button>
        </div>
        {state.filters.length === 0 && (
          <p className="text-gray-400 dark:text-gray-600 text-[10px] italic">No filters</p>
        )}
        {state.filters.map((f) => (
          <div key={f.id} className="flex items-center gap-1">
            <select value={f.col} onChange={(e) => patchFilter(f.id, { col: e.target.value })} className={selectCls + ' flex-1 min-w-0'}>
              {colNames.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={f.op} onChange={(e) => patchFilter(f.id, { op: e.target.value as FilterOp })} className={selectCls + ' w-24 flex-shrink-0'}>
              {FILTER_OPS.map((op) => <option key={op}>{op}</option>)}
            </select>
            {f.op !== 'IS NULL' && f.op !== 'IS NOT NULL' && (
              <input
                value={f.value}
                onChange={(e) => patchFilter(f.id, { value: e.target.value })}
                placeholder="value"
                className={inputCls + ' flex-1 min-w-0'}
              />
            )}
            <RemoveBtn onClick={() => removeFilter(f.id)} />
          </div>
        ))}
      </div>

      {/* ── ORDER BY ──────────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Order by</span>
          <button onClick={addSort} className={addBtn}>+ Add sort</button>
        </div>
        {state.sorts.length === 0 && (
          <p className="text-gray-400 dark:text-gray-600 text-[10px] italic">No sorts</p>
        )}
        {state.sorts.map((s) => (
          <div key={s.id} className="flex items-center gap-1">
            <select value={s.col} onChange={(e) => patchSort(s.id, { col: e.target.value })} className={selectCls + ' flex-1'}>
              {colNames.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button
              onClick={() => patchSort(s.id, { dir: s.dir === 'ASC' ? 'DESC' : 'ASC' })}
              className="px-2 py-0.5 border border-gray-200 dark:border-gray-700 rounded text-[11px] bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors w-14 flex-shrink-0 text-center"
            >
              {s.dir}
            </button>
            <RemoveBtn onClick={() => removeSort(s.id)} />
          </div>
        ))}
      </div>

      {/* ── LIMIT ─────────────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 flex items-center gap-2">
        <span className={sectionLabel}>Limit</span>
        <input
          type="number"
          min={1}
          max={1000000}
          value={state.limit}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            if (n > 0) update({ limit: n })
          }}
          className={inputCls + ' w-24'}
        />
        <span className="text-gray-400 dark:text-gray-600 text-[10px]">rows</span>
      </div>

    </div>
  )
}
