import { NavLink, useNavigate } from 'react-router-dom';
import {
  Activity, Database, Layers, Settings,
  UploadCloud, RefreshCw,
} from 'lucide-react';
import { useSidebar } from '../context/SidebarContext';
import { useSignals } from '../context/SignalsContext';
import { useTheme } from '../context/ThemeContext';
import type { SignalMetadata } from '../types/signal';

const NAV_ITEMS = [
  { to: '/',         label: 'Explorer', icon: Activity,  end: true  },
  { to: '/signals',  label: 'Signals',  icon: Database,  end: false },
  { to: '/groups',   label: 'Groups',   icon: Layers,    end: false },
  { to: '/settings', label: 'Settings', icon: Settings,  end: false },
];

const STATUS_DOT: Record<SignalMetadata['status'], string> = {
  COMPLETED:  'bg-green-500',
  PROCESSING: 'bg-blue-500 animate-pulse',
  PENDING:    'bg-yellow-500 animate-pulse',
  FAILED:     'bg-red-500',
};

export default function Sidebar() {
  const { isCollapsed } = useSidebar();
  const navigate = useNavigate();
  const { signals } = useSignals();
  const { theme } = useTheme();

  const processingCount = signals.filter(
    (s) => s.status === 'PENDING' || s.status === 'PROCESSING',
  ).length;

  const sidebarBg = theme === 'light'
    ? 'bg-[#f8f9fa] border-r border-[var(--sp-border-subtle)]'
    : 'bg-zinc-900 border-r border-zinc-800';

  return (
    <aside
      className={`flex-shrink-0 flex flex-col transition-[width] duration-200 ease-in-out overflow-hidden ${sidebarBg} ${
        isCollapsed ? 'w-14' : 'w-60'
      }`}
    >

      {/* Navigation items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={isCollapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-2.5 py-2.5 rounded text-sm font-sans transition-colors ${
                isActive
                  ? 'bg-brand-500/15 text-brand-400 border border-brand-500/25'
                  : 'border border-transparent hover:bg-zinc-800/10'
              }`
            }
            style={({ isActive }) => isActive ? {} : { color: 'var(--sp-text-secondary)' }}
          >
            <Icon size={16} className="flex-shrink-0" />
            {!isCollapsed && (
              <span>{label}</span>
            )}
          </NavLink>
        ))}

        {/* Recent signals quick-list */}
        {!isCollapsed && signals.length > 0 && (
          <div className="pt-5">
            <div className="flex items-center justify-between px-2.5 mb-2">
              <p className="text-xs font-sans font-semibold" style={{ color: 'var(--sp-text-muted)' }}>
                Recent
              </p>
              {processingCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-mono text-blue-400">
                  <RefreshCw size={10} className="animate-spin" />
                  {processingCount}
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              {signals.slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate('/')}
                  title={s.original_filename}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs font-mono hover:bg-zinc-800/10 transition-colors text-left"
                  style={{ color: 'var(--sp-text-muted)' }}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[s.status]}`} />
                  <span className="truncate flex-1">{s.original_filename}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Upload button pinned at bottom */}
      <div className="p-2 border-t flex-shrink-0" style={{ borderColor: 'var(--sp-border-subtle)' }}>
        <button
          onClick={() => navigate('/signals')}
          title={isCollapsed ? 'Upload Signal' : undefined}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded text-sm font-sans
            text-brand-400 hover:text-blue-300 hover:bg-brand-500/10
            border border-transparent hover:border-brand-500/20 transition-colors ${
              isCollapsed ? 'justify-center' : ''
            }`}
        >
          <UploadCloud size={16} className="flex-shrink-0" />
          {!isCollapsed && <span>Upload Signal</span>}
        </button>
      </div>
    </aside>
  );
}
