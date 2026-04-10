import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

interface Props {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  isDark: boolean
}

// Stable refs pattern: keep callbacks in refs so the CodeMirror extension
// closure never captures stale values without needing to re-create the editor.
export function SqlEditor({ value, onChange, onRun, isDark }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef      = useRef<EditorView | null>(null)
  const onRunRef     = useRef(onRun)
  const onChangeRef  = useRef(onChange)
  onRunRef.current    = onRun
  onChangeRef.current = onChange

  // (Re-)create the editor when the theme changes; otherwise keep stable.
  useEffect(() => {
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sql(),
          ...(isDark ? [oneDark] : []),
          keymap.of([{
            key: 'Ctrl-Enter',
            mac: 'Cmd-Enter',
            run: () => { onRunRef.current(); return true },
          }]),
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

  // Sync an externally driven value change (e.g. new file loaded) into the editor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div ref={containerRef} className="h-full" />
}
