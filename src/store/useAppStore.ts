import { create } from 'zustand'
import type { ActiveFile, ColumnInfo, FileStats, GeoInfo, QueryResult } from '../types'

type Theme = 'light' | 'dark' | 'system'

interface AppStore {
  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void

  // Loaded file
  activeFile: ActiveFile | null
  schema: ColumnInfo[] | null
  fileStats: FileStats | null
  geoInfo: GeoInfo | null
  setActiveFile: (file: ActiveFile | null) => void
  setSchema: (schema: ColumnInfo[] | null) => void
  setFileStats: (stats: FileStats | null) => void
  setGeoInfo: (info: GeoInfo | null) => void
  setGeoEpsg: (epsg: number | null) => void
  clearFile: () => void

  // Query result — populated by SQL panel, consumed by DataTable + MapView
  queryResult: QueryResult | null
  setQueryResult: (result: QueryResult | null) => void

  // Map ↔ table sync (Phase 5)
  hoveredRowId: number | null
  selectedRowId: number | null
  setHoveredRowId: (id: number | null) => void
  setSelectedRowId: (id: number | null) => void

  // Split layout ratio (Phase 4)
  splitRatio: number
  setSplitRatio: (ratio: number) => void
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme') as Theme | null
  return stored ?? 'system'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

const initialTheme = getInitialTheme()
applyTheme(initialTheme)

export const useAppStore = create<AppStore>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    localStorage.setItem('theme', theme)
    applyTheme(theme)
    set({ theme })
  },

  activeFile: null,
  schema: null,
  fileStats: null,
  geoInfo: null,
  setActiveFile: (file) => set({ activeFile: file }),
  setSchema: (schema) => set({ schema }),
  setFileStats: (stats) => set({ fileStats: stats }),
  setGeoInfo: (info) => set({ geoInfo: info }),
  setGeoEpsg: (epsg) => set((state) => {
    if (!state.geoInfo) return {}
    return { geoInfo: { ...state.geoInfo, epsg, isWGS84: epsg == null || epsg === 4326 } }
  }),
  clearFile: () => set({ activeFile: null, schema: null, fileStats: null, geoInfo: null, queryResult: null }),

  queryResult: null,
  setQueryResult: (result) => set({ queryResult: result }),

  hoveredRowId: null,
  selectedRowId: null,
  setHoveredRowId: (id) => set({ hoveredRowId: id }),
  setSelectedRowId: (id) => set({ selectedRowId: id }),

  splitRatio: parseFloat(localStorage.getItem('splitRatio') ?? '65'),
  setSplitRatio: (ratio) => {
    localStorage.setItem('splitRatio', String(ratio))
    set({ splitRatio: ratio })
  },
}))
