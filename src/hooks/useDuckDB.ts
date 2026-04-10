import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import { useSyncExternalStore } from 'react'

export type DBStatus = 'initializing' | 'ready' | 'error'

interface DBState {
  status: DBStatus
  error?: string
}

// Module-level singletons — initialized once for the lifetime of the app
let dbInstance: duckdb.AsyncDuckDB | null = null
let connInstance: duckdb.AsyncDuckDBConnection | null = null
let state: DBState = { status: 'initializing' }
const subscribers = new Set<() => void>()

function notify() {
  subscribers.forEach((cb) => cb())
}

function setState(next: DBState) {
  state = next
  notify()
}

function getSnapshot(): DBState {
  return state
}

function subscribe(cb: () => void) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

// Kick off initialization immediately when this module is first imported
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
  eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
}

;(async () => {
  try {
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
    // Resolve to an absolute URL — importScripts() inside a blob: worker cannot
    // resolve relative URLs since its base is blob:, not the page origin.
    const absoluteWorkerUrl = new URL(bundle.mainWorker!, window.location.href).href
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${absoluteWorkerUrl}")`], { type: 'text/javascript' })
    )
    const worker = new Worker(workerUrl)
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    dbInstance = new duckdb.AsyncDuckDB(logger, worker)
    await dbInstance.instantiate(bundle.mainModule, bundle.pthreadWorker)
    connInstance = await dbInstance.connect()
    URL.revokeObjectURL(workerUrl)
    setState({ status: 'ready' })
  } catch (e) {
    setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
})()

/** Convert an Arrow row to a plain JS object, normalizing BigInt → number */
function rowToObject(
  row: Record<string, unknown>,
  fields: { name: string }[]
): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const field of fields) {
    const val = row[field.name]
    obj[field.name] = typeof val === 'bigint' ? Number(val) : val
  }
  return obj
}

export async function queryDB(sql: string): Promise<Record<string, unknown>[]> {
  if (!connInstance) throw new Error('DuckDB is not initialized yet')
  const result = await connInstance.query(sql)
  const fields = result.schema.fields
  return result.toArray().map((row) => rowToObject(row as Record<string, unknown>, fields))
}

export function getDBInstance() {
  return dbInstance
}

export function getConnection() {
  return connInstance
}

export function useDuckDB() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
