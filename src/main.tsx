import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import App from './App'

// Sync system theme preference on load
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const storedTheme = localStorage.getItem('theme')
if (!storedTheme || storedTheme === 'system') {
  document.documentElement.classList.toggle('dark', mediaQuery.matches)
}
mediaQuery.addEventListener('change', (e) => {
  if (!localStorage.getItem('theme') || localStorage.getItem('theme') === 'system') {
    document.documentElement.classList.toggle('dark', e.matches)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
