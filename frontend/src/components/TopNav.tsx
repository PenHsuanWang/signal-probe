import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity, Menu, Search, Bell,
  ChevronRight, Settings, LogOut, Sun, Moon,
} from 'lucide-react';
import { useSidebar } from '../context/SidebarContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const ROUTE_LABELS: Record<string, string> = {
  '/':         'Explorer',
  '/signals':  'Signal Library',
  '/groups':   'Groups',
  '/settings': 'Settings',
};

export default function TopNav() {
  const { toggle } = useSidebar();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const pageLabel = ROUTE_LABELS[location.pathname] ?? 'Explorer';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const navBg = theme === 'light'
    ? 'bg-white border-b border-[var(--sp-border-subtle)]'
    : 'bg-zinc-900 border-b border-zinc-800';

  return (
    <header className={`h-14 flex-shrink-0 flex items-center px-4 gap-3 z-50 ${navBg}`}>

      {/* Hamburger */}
      <button
        onClick={toggle}
        aria-label="Toggle sidebar"
        className="p-1.5 rounded hover:bg-zinc-800/10 text-zinc-400 hover:text-zinc-100 transition-colors flex-shrink-0"
        style={{ color: 'var(--sp-text-secondary)' }}
      >
        <Menu size={18} />
      </button>

      {/* Logo */}
      <Link to="/" className="flex items-center gap-2 flex-shrink-0">
        <Activity size={18} className="text-brand-500" />
        <span className="text-sm font-semibold font-sans hidden sm:block" style={{ color: 'var(--sp-text-primary)' }}>
          Signal Probe
        </span>
      </Link>

      {/* Breadcrumb separator + page label */}
      <div className="hidden sm:flex items-center gap-2 flex-shrink-0" style={{ color: 'var(--sp-text-muted)' }}>
        <ChevronRight size={14} />
        <span className="text-sm font-sans" style={{ color: 'var(--sp-text-secondary)' }}>{pageLabel}</span>
      </div>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative hidden md:flex items-center flex-shrink-0">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--sp-text-muted)' }} />
        <input
          placeholder="Search signals…"
          aria-label="Search signals"
          disabled
          title="Search coming soon"
          className="border rounded text-xs font-mono pl-8 pr-3 py-1.5 w-52 focus:outline-none cursor-not-allowed opacity-50 transition-all"
          style={{
            backgroundColor: 'var(--sp-surface-elevated)',
            borderColor: 'var(--sp-border-default)',
            color: 'var(--sp-text-secondary)',
          }}
        />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="p-1.5 rounded transition-colors flex-shrink-0"
        style={{ color: 'var(--sp-text-secondary)' }}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* Notification bell */}
      <button
        aria-label="Notifications"
        className="p-1.5 rounded transition-colors flex-shrink-0"
        style={{ color: 'var(--sp-text-secondary)' }}
      >
        <Bell size={16} />
      </button>

      {/* User menu */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-xs font-sans transition-colors"
          style={{ color: 'var(--sp-text-secondary)' }}
        >
          <div className="w-6 h-6 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400 text-xs font-semibold flex-shrink-0">
            {user?.email?.[0]?.toUpperCase() ?? '?'}
          </div>
          <span className="hidden sm:block max-w-[128px] truncate">{user?.email}</span>
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-52 rounded-lg shadow-2xl overflow-hidden z-50 border"
            style={{
              backgroundColor: 'var(--sp-surface-secondary)',
              borderColor: 'var(--sp-border-default)',
            }}
          >
            <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--sp-border-subtle)' }}>
              <p className="text-[10px] font-sans uppercase tracking-wide" style={{ color: 'var(--sp-text-muted)' }}>Signed in as</p>
              <p className="text-xs font-mono truncate mt-0.5" style={{ color: 'var(--sp-text-secondary)' }}>{user?.email}</p>
            </div>
            <div className="p-1">
              <Link
                to="/settings"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-sans rounded transition-colors hover:bg-zinc-800/10"
                style={{ color: 'var(--sp-text-secondary)' }}
              >
                <Settings size={13} />
                <span>Settings</span>
              </Link>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-sans text-red-400 rounded transition-colors hover:bg-zinc-800/10"
              >
                <LogOut size={13} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
