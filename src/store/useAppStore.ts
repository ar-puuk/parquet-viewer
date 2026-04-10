import { create } from 'zustand'

type Theme = 'light' | 'dark' | 'system'

interface AppStore {
  theme: Theme
  setTheme: (theme: Theme) => void
  hoveredRowId: number | null
  selectedRowId: number | null
  setHoveredRowId: (id: number | null) => void
  setSelectedRowId: (id: number | null) => void
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
