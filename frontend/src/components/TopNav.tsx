import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity, Menu, Search, Bell,
  ChevronRight, Settings, LogOut,
} from 'lucide-react';
import { useSidebar } from '../context/SidebarContext';
import { useAuth } from '../context/AuthContext';

const ROUTE_LABELS: Record<string, string> = {
  '/':         'Explorer',
  '/signals':  'Signals',
  '/groups':   'Groups',
  '/settings': 'Settings',
};

export default function TopNav() {
  const { toggle } = useSidebar();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const pageLabel = ROUTE_LABELS[location.pathname] ?? 'Explorer';

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="h-14 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-3 z-50">

      {/* Hamburger */}
      <button
        onClick={toggle}
        aria-label="Toggle sidebar"
        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors flex-shrink-0"
      >
        <Menu size={18} />
      </button>

      {/* Logo */}
      <Link to="/" className="flex items-center gap-2 flex-shrink-0">
        <Activity size={18} className="text-brand-500" />
        <span className="text-sm font-bold font-mono tracking-tight text-zinc-100 hidden sm:block">
          SIGNAL_PROBE
        </span>
      </Link>

      {/* Breadcrumb separator + page label */}
      <div className="hidden sm:flex items-center gap-2 text-zinc-600 flex-shrink-0">
        <ChevronRight size={14} />
        <span className="text-sm font-mono text-zinc-400">{pageLabel}</span>
      </div>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative hidden md:flex items-center flex-shrink-0">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          placeholder="Search signals…"
          aria-label="Search signals"
          disabled
          title="Search coming soon"
          className="bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-300 pl-8 pr-3 py-1.5 w-52 focus:outline-none placeholder:text-zinc-600 cursor-not-allowed opacity-50 transition-all"
        />
      </div>

      {/* Notification bell */}
      <button
        aria-label="Notifications"
        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors flex-shrink-0"
      >
        <Bell size={16} />
      </button>

      {/* User menu */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400 text-xs font-bold flex-shrink-0">
            {user?.email?.[0]?.toUpperCase() ?? '?'}
          </div>
          <span className="hidden sm:block max-w-[128px] truncate">{user?.email}</span>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden z-50">
            <div className="px-3 py-2.5 border-b border-zinc-800">
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Signed in as</p>
              <p className="text-xs font-mono text-zinc-300 truncate mt-0.5">{user?.email}</p>
            </div>
            <div className="p-1">
              <Link
                to="/settings"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-mono text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
              >
                <Settings size={13} />
                <span>Settings</span>
              </Link>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-mono text-red-400 hover:bg-zinc-800 rounded transition-colors"
              >
                <LogOut size={13} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
