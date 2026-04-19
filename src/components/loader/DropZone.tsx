import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { useDuckDB } from '../../hooks/useDuckDB'
import { useParquetFile } from '../../hooks/useParquetFile'
import { UrlInput } from './UrlInput'

export function DropZone() {
  const { status: dbStatus, error: dbError } = useDuckDB()
  const { loadFile, loadUrl, loading, error, clearError } = useParquetFile()
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isReady = dbStatus === 'ready'

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave() {
    setDragging(false)
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) await loadFile(file)
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await loadFile(file)
  }

  const fileError = error ?? (dbStatus === 'error' ? `DuckDB failed to initialize: ${dbError}` : null)

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-[#fffbf2] dark:bg-[#0e171e]">
      <div className="w-full max-w-xl">

        {/* DuckDB init status */}
        {dbStatus === 'initializing' && (
          <div className="mb-6 flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-white dark:bg-[#192430] border border-[#d4c5a9] dark:border-[#253545] shadow-panel dark:shadow-panel-dark">
            <svg className="animate-spin w-4 h-4 text-[#b45309] dark:text-[#fbbf24] flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-xs text-[#6b5e4a] dark:text-[#8a98a8]">Initializing query engine…</span>
          </div>
        )}

        {/* Error banner */}
        {fileError && (
          <div className="mb-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/60 text-sm text-red-700 dark:text-red-300 shadow-sm">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0 mt-0.5">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span className="flex-1">{fileError}</span>
            <button onClick={clearError} className="text-red-400 hover:text-red-600 dark:hover:text-red-200 flex-shrink-0">✕</button>
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => isReady && !loading && fileInputRef.current?.click()}
          className={[
            'border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200',
            isReady && !loading ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            dragging
              ? 'border-[#b45309] dark:border-[#fbbf24] bg-[#fef3c7] dark:bg-[#2d1c04] shadow-[0_0_0_4px_rgba(180,83,9,0.12)] dark:shadow-[0_0_0_4px_rgba(251,191,36,0.15)]'
              : 'border-[#d4c5a9] dark:border-[#2f4258] bg-white dark:bg-[#131e28] hover:border-[#b45309] dark:hover:border-[#fbbf24] hover:bg-[#fef3c7]/30 dark:hover:bg-[#2d1c04]/30 shadow-panel dark:shadow-panel-dark',
          ].join(' ')}
        >
          <div className="flex flex-col items-center gap-4">
            <div className={[
              'w-16 h-16 rounded-2xl flex items-center justify-center transition-colors border',
              dragging
                ? 'bg-[#fde68a] dark:bg-[#2d1c04] border-[#b45309] dark:border-[#fbbf24]'
                : 'bg-[#fef3c7] dark:bg-[#1f2d3a] border-[#e8dfc8] dark:border-[#253545]',
            ].join(' ')}>
              {loading ? (
                <svg className="animate-spin w-8 h-8 text-[#b45309] dark:text-[#fbbf24]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-[#b45309] dark:text-[#fbbf24]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              )}
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight text-[#1c1208] dark:text-[#f0ebe0]">
                {loading ? 'Loading file…' : 'Drop a Parquet file here'}
              </p>
              <p className="mt-1.5 text-sm text-[#6b5e4a] dark:text-[#8a98a8] leading-relaxed">
                {loading
                  ? 'Reading schema and metadata'
                  : <>or click to browse — supports <code className="font-mono text-xs bg-[#f2ece0] dark:bg-[#253545] px-1 py-0.5 rounded">.parquet</code> and GeoParquet</>
                }
              </p>
            </div>
            {!loading && (
              <button
                type="button"
                disabled={!isReady}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                className="mt-2 px-5 py-2 bg-[#b45309] hover:bg-[#92400e] dark:bg-[#fbbf24] dark:hover:bg-[#f59e0b] disabled:opacity-40 disabled:cursor-not-allowed text-white dark:text-[#1c1208] text-sm font-semibold rounded-lg transition-colors duration-150 shadow-sm"
              >
                Choose file
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".parquet"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* URL input */}
        <UrlInput onSubmit={loadUrl} disabled={!isReady || loading} />

        <p className="mt-8 text-center text-xs text-[#a8977a] dark:text-[#485868] tracking-wide">
          Public S3 buckets and HTTP URLs supported · No data leaves your browser
        </p>
      </div>
    </div>
  )
}
