import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sun, Moon, LogOut, User } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'

export function Header() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useUIStore()
  const { user, logout } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="h-[76px] border-b border-sky-100 bg-background flex items-center justify-between px-8 shrink-0 relative z-50 shadow-[0_4px_20px_rgba(2,132,199,0.03)]">
      <div className="flex items-center space-x-3">
        {/* Logo */}
        <div className="bg-sky-50 text-brand-accent w-10 h-10 rounded-xl flex items-center justify-center border border-sky-200 shadow-sm">
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="6" fill="currentColor" />
            <path d="M16 6l8 12H8l8-12z" fill="white" />
            <circle cx="16" cy="22" r="3" fill="white" />
          </svg>
        </div>

        {/* Brand */}
        <div className="flex items-baseline gap-1.5">
          <span className="font-extrabold text-sm tracking-tight text-foreground">
            TASK<span className="text-brand-accent">IT</span>
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="text-[11px] text-muted-foreground font-medium">模型工坊</span>
        </div>
      </div>

      {/* Right: theme + user */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-muted transition"
          title={theme === 'dark' ? '切换亮色' : '切换暗色'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {user && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-8 h-8 rounded-lg bg-brand-light-bg text-brand-accent text-xs font-bold flex items-center justify-center hover:bg-sky-100 transition"
            >
              {(user.name || user.email)[0].toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-20 w-44 rounded-lg border border-sky-100 bg-background shadow-lg py-1">
                  <div className="px-3 py-2">
                    <div className="text-xs font-medium text-foreground truncate">{user.name || user.email}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
                  </div>
                  <hr className="border-border" />
                  <button
                    onClick={() => { logout(); navigate('/login'); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition"
                  >
                    <LogOut className="h-3 w-3" />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
