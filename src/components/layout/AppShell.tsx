import { useAppStore } from '../../store/useAppStore'
import { Link } from 'react-router-dom'
import { useCallback } from 'react'

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
)

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const SystemIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, setTheme, clearFile } = useAppStore()
  const handleLogoClick = useCallback(() => clearFile(), [clearFile])

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light')
    else if (theme === 'light') setTheme('dark')
    else setTheme('system')
  }

  const ThemeIcon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : SystemIcon
  const themeLabel = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'

  return (
    <div className="h-screen overflow-hidden bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 flex flex-col">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 z-10 flex-shrink-0">
        <div className="max-w-screen-2xl mx-auto px-4 h-12 flex items-center justify-between">
          <Link to="/" onClick={handleLogoClick} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <svg viewBox="0 0 32 32" className="w-7 h-7" fill="none">
              <rect width="32" height="32" rx="6" fill="#6366f1" />
              <path d="M8 10h6a4 4 0 0 1 0 8H8V10z" fill="white" />
              <rect x="8" y="20" width="4" height="2" rx="1" fill="white" />
              <rect x="16" y="20" width="8" height="2" rx="1" fill="white" />
              <rect x="16" y="14" width="8" height="2" rx="1" fill="white" />
            </svg>
            <span className="font-semibold text-sm tracking-tight">Parquet Explorer</span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={cycleTheme}
              title={`Theme: ${themeLabel} (click to cycle)`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ThemeIcon />
              <span className="hidden sm:inline">{themeLabel}</span>
            </button>

            <a
              href="https://github.com/ar-puuk/parquet-viewer"
              target="_blank"
              rel="noopener noreferrer"
              title="View on GitHub"
              className="p-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <GitHubIcon />
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  )
}
