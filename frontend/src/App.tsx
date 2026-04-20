import { Component, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import SignalsPage from './pages/SignalsPage';
import GroupsPage from './pages/GroupsPage';
import SettingsPage from './pages/SettingsPage';

// ── Global error boundary ────────────────────────────────────────────────────
interface EBState { hasError: boolean; message: string }

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): EBState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-zinc-900 border border-red-500/30 rounded-lg p-6 space-y-4">
            <h1 className="font-mono text-red-400 font-bold text-sm tracking-widest uppercase">
              ⚠ Unexpected Error
            </h1>
            <p className="font-mono text-zinc-400 text-xs break-all">{this.state.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2 text-xs font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="signals" element={<SignalsPage />} />
              <Route path="groups" element={<GroupsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
