import { Settings, User, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings size={20} className="text-brand-500" />
        <div>
          <h1 className="text-sm font-bold font-mono text-zinc-100 tracking-widest uppercase">Settings</h1>
          <p className="text-xs font-mono text-zinc-500 mt-0.5">Account and application preferences</p>
        </div>
      </div>

      {/* Account */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <User size={13} className="text-brand-500" />
          <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">Account</p>
        </div>
        <div className="divide-y divide-zinc-800/50">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500">Email</span>
            <span className="text-xs font-mono text-zinc-200">{user?.email}</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500">Role</span>
            <span className="text-xs font-mono">
              {user?.is_superuser
                ? <span className="text-yellow-400">Superuser</span>
                : <span className="text-zinc-400">Analyst</span>}
            </span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500">Account status</span>
            <span className={`text-xs font-mono ${user?.is_active ? 'text-green-400' : 'text-red-400'}`}>
              {user?.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Preferences — coming soon */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden opacity-50">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Settings size={13} className="text-brand-500" />
          <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">Preferences</p>
          <span className="ml-auto text-[10px] font-mono text-zinc-700">Coming soon</span>
        </div>
        <div className="divide-y divide-zinc-800/50">
          {['Default chart theme', 'OOC threshold override', 'Auto-select on upload', 'Date format'].map((label) => (
            <div key={label} className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-500">{label}</span>
              <span className="text-xs font-mono text-zinc-700">—</span>
            </div>
          ))}
        </div>
      </div>

      {/* About */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Info size={13} className="text-brand-500" />
          <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">About</p>
        </div>
        <div className="divide-y divide-zinc-800/50">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500">Application</span>
            <span className="text-xs font-mono text-zinc-300">SIGNAL_PROBE</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500">Version</span>
            <span className="text-xs font-mono text-zinc-600">v0.1.0-alpha</span>
          </div>
        </div>
      </div>

    </div>
  );
}
