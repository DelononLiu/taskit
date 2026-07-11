import { create } from 'zustand'

interface UIState {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return 'light'
}

const initialTheme = getInitialTheme()
if (initialTheme === 'dark') {
  document.documentElement.classList.add('dark')
}

export const useUIStore = create<UIState>((set) => ({
  theme: initialTheme,
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'light' ? 'dark' : 'light'
      if (next === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      localStorage.setItem('theme', next)
      return { theme: next }
    }),
}))
