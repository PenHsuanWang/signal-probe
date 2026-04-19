import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, LogOut, User } from 'lucide-react';

export default function MainLayout() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin text-brand-500">
          <Activity size={32} />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Activity className="text-brand-500" />
          <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">SIGNAL_PROBE</h1>
        </div>
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2 text-sm text-zinc-400">
            <User size={16} />
            <span>{user?.email}</span>
          </div>
          <button
            onClick={logout}
            className="flex items-center space-x-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
