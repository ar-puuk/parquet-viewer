import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import type { ColumnInfo } from '../../types'

interface Props {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  isDark: boolean
  schema?: ColumnInfo[] | null
  onHistoryUp?: () => void
  onHistoryDown?: () => void
}

// Stable refs pattern: keep callbacks in refs so the CodeMirror extension
// closure never captures stale values without needing to re-create the editor.
export function SqlEditor({ value, onChange, onRun, isDark, schema, onHistoryUp, onHistoryDown }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null)
  const viewRef        = useRef<EditorView | null>(null)
  const onRunRef       = useRef(onRun)
  const onChangeRef    = useRef(onChange)
  const onHistoryUpRef = useRef(onHistoryUp)
  const onHistoryDownRef = useRef(onHistoryDown)
  onRunRef.current       = onRun
  onChangeRef.current    = onChange
  onHistoryUpRef.current = onHistoryUp
  onHistoryDownRef.current = onHistoryDown

  // Compartment for SQL autocomplete so schema can be updated without
  // recreating the whole editor.
  const sqlCompartmentRef = useRef(new Compartment())

  function buildSqlExt(cols: ColumnInfo[] | null | undefined) {
    return sql({
      schema: { data: cols?.map((c) => c.name) ?? [] },
      defaultTable: 'data',
    })
  }

  // (Re-)create the editor when the theme changes; otherwise keep stable.
  useEffect(() => {
    if (!containerRef.current) return
    const sqlCompartment = sqlCompartmentRef.current

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sqlCompartment.of(buildSqlExt(schema)),
          ...(isDark ? [oneDark] : []),
          keymap.of([
            {
              key: 'Ctrl-Enter',
              mac: 'Cmd-Enter',
              run: () => { onRunRef.current(); return true },
            },
            {
              key: 'ArrowUp',
              run: (v) => {
                const line = v.state.doc.lineAt(v.state.selection.main.from)
                if (line.number === 1) { onHistoryUpRef.current?.(); return true }
                return false
              },
            },
            {
              key: 'ArrowDown',
              run: (v) => {
                const line = v.state.doc.lineAt(v.state.selection.main.from)
                if (line.number === v.state.doc.lines) { onHistoryDownRef.current?.(); return true }
                return false
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '12px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            '.cm-content': { padding: '6px 0' },
          }),
        ],
      }),
      parent: containerRef.current,
    })

    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  // Sync an externally driven value change (e.g. new file loaded / history nav).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  // Update autocomplete schema without recreating the editor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: sqlCompartmentRef.current.reconfigure(buildSqlExt(schema)),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema])

  return <div ref={containerRef} className="h-full" />
}
