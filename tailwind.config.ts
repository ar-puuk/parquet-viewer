import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark:           '#0e171e',
          cream:          '#fffbf2',
          amber:          '#b45309',
          'amber-bright': '#fbbf24',
        },
        surface: {
          base:    '#fffbf2',
          panel:   '#f2ece0',
          card:    '#ffffff',
          overlay: '#f8f4ec',
        },
        'surface-dark': {
          base:    '#0e171e',
          panel:   '#131e28',
          card:    '#192430',
          overlay: '#1f2d3a',
        },
        border: {
          subtle:       '#e8dfc8',
          default:      '#d4c5a9',
          strong:       '#b8a88a',
          'dark-subtle':  '#1e2e3c',
          'dark-default': '#253545',
          'dark-strong':  '#2f4258',
        },
        content: {
          primary:          '#1c1208',
          secondary:        '#6b5e4a',
          muted:            '#a8977a',
          'dark-primary':   '#f0ebe0',
          'dark-secondary': '#8a98a8',
          'dark-muted':     '#485868',
        },
        accent: {
          DEFAULT:      '#b45309',
          hover:        '#92400e',
          subtle:       '#fef3c7',
          dark:         '#fbbf24',
          'dark-hover':   '#f59e0b',
          'dark-subtle':  '#2d1c04',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Fira Code', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel:        '0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.03)',
        'panel-dark': '0 1px 3px 0 rgba(0,0,0,0.4)',
        popup:        '0 4px 16px rgba(0,0,0,0.10)',
        'popup-dark': '0 4px 20px rgba(0,0,0,0.70)',
      },
    },
  },
  plugins: [],
}

export default config
