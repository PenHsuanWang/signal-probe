import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity } from 'lucide-react';
import { SidebarProvider } from '../context/SidebarContext';
import { SignalsProvider } from '../context/SignalsContext';
import TopNav from '../components/TopNav';
import Sidebar from '../components/Sidebar';

export default function MainLayout() {
  const { isAuthenticated, isLoading } = useAuth();

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
    <SidebarProvider>
      <SignalsProvider>
        <div className="flex flex-col h-screen overflow-hidden bg-zinc-950 text-zinc-100">
          <TopNav />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </SignalsProvider>
    </SidebarProvider>
  );
}
