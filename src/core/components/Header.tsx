export function Header() {
  return (
    <header className="h-[76px] border-b border-sky-100 bg-white flex items-center px-8 shrink-0 relative z-50 shadow-[0_4px_20px_rgba(2,132,199,0.03)]">
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
          <span className="font-extrabold text-sm tracking-tight text-slate-800">
            TASK<span className="text-brand-accent">IT</span>
          </span>
          <span className="h-3 w-px bg-slate-300" />
          <span className="text-[11px] text-slate-400 font-medium">模型工坊</span>
        </div>
      </div>
    </header>
  )
}
