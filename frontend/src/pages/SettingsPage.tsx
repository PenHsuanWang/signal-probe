import { Settings, Sun, Moon, User, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings size={20} className="text-brand-500" />
        <div>
          <h1 className="text-sm font-semibold font-sans" style={{ color: 'var(--sp-text-primary)' }}>Settings</h1>
          <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--sp-text-secondary)' }}>Account and application preferences</p>
        </div>
      </div>

      {/* Account */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--sp-border)' }}>
          <User size={13} className="text-brand-500" />
          <p className="text-[10px] font-sans font-semibold uppercase tracking-wide" style={{ color: 'var(--sp-text-tertiary)' }}>Account</p>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--sp-border)' }}>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Email</span>
            <span className="text-xs font-mono" style={{ color: 'var(--sp-text-primary)' }}>{user?.email}</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Role</span>
            <span className="text-xs font-sans">
              {user?.is_superuser
                ? <span className="text-yellow-400">Superuser</span>
                : <span style={{ color: 'var(--sp-text-secondary)' }}>Analyst</span>}
            </span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Account status</span>
            <span className={`text-xs font-sans ${user?.is_active ? 'text-green-400' : 'text-red-400'}`}>
              {user?.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Display Preferences */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--sp-border)' }}>
          <Settings size={13} className="text-brand-500" />
          <p className="text-[10px] font-sans font-semibold uppercase tracking-wide" style={{ color: 'var(--sp-text-tertiary)' }}>Display</p>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-primary)' }}>Colour scheme</span>
            <p className="text-[10px] font-sans mt-0.5" style={{ color: 'var(--sp-text-tertiary)' }}>
              Affects charts, backgrounds, and all UI surfaces.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md p-0.5" style={{ background: 'var(--sp-surface-elevated)', border: '1px solid var(--sp-border)' }}>
            <button
              onClick={() => setTheme('dark')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-sans transition-all ${
                theme === 'dark' ? 'bg-brand-500 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Moon size={12} /> Dark
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-sans transition-all ${
                theme === 'light' ? 'bg-brand-500 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sun size={12} /> Light
            </button>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--sp-border)' }}>
          <Info size={13} className="text-brand-500" />
          <p className="text-[10px] font-sans font-semibold uppercase tracking-wide" style={{ color: 'var(--sp-text-tertiary)' }}>About</p>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--sp-border)' }}>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Application</span>
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-primary)' }}>Signal Probe</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-sans" style={{ color: 'var(--sp-text-secondary)' }}>Version</span>
            <span className="text-xs font-mono" style={{ color: 'var(--sp-text-tertiary)' }}>v0.1.0-alpha</span>
          </div>
        </div>
      </div>

    </div>
  );
}
