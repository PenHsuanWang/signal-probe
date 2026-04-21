import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Activity } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const formData = new URLSearchParams();
      formData.append('username', email); // OAuth2 password flow uses 'username'
      formData.append('password', password);

      const res = await api.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const token = res.data.access_token;

      const userRes = await api.get('/users/me', {
        headers: { Authorization: `Bearer ${token}` }
      });

      login(token, userRes.data);
      navigate('/');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((d: any) => d.msg).join('; '));
      } else {
        setError(detail || 'Failed to login');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8"
         style={{ background: 'var(--sp-surface-primary)' }}>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Activity className="h-12 w-12 text-brand-500" />
        </div>
        <h2 className="mt-6 text-center text-2xl font-semibold tracking-tight font-sans"
            style={{ color: 'var(--sp-text-primary)' }}>
          Sign in to Signal Probe
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="py-8 px-4 shadow sm:rounded-lg sm:px-10"
             style={{ background: 'var(--sp-surface-secondary)', border: '1px solid var(--sp-border)' }}>
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm p-3 rounded font-sans">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium font-sans" style={{ color: 'var(--sp-text-primary)' }}>
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full appearance-none rounded-md px-3 py-2 font-sans text-sm focus:border-brand-500 focus:outline-none focus:ring-brand-500"
                  style={{ border: '1px solid var(--sp-border)', background: 'var(--sp-surface-elevated)', color: 'var(--sp-text-primary)' }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium font-sans" style={{ color: 'var(--sp-text-primary)' }}>
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full appearance-none rounded-md px-3 py-2 font-sans text-sm focus:border-brand-500 focus:outline-none focus:ring-brand-500"
                  style={{ border: '1px solid var(--sp-border)', background: 'var(--sp-surface-elevated)', color: 'var(--sp-text-primary)' }}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="flex w-full justify-center rounded-md border border-transparent bg-brand-500 py-2 px-4 text-sm font-medium font-sans text-white shadow-sm hover:bg-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {isLoading ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" style={{ borderColor: 'var(--sp-border)' }} />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 font-sans" style={{ background: 'var(--sp-surface-secondary)', color: 'var(--sp-text-secondary)' }}>Or</span>
              </div>
            </div>

            <div className="mt-6 text-center text-sm font-sans" style={{ color: 'var(--sp-text-secondary)' }}>
              Don&apos;t have an account?{' '}
              <Link to="/register" className="font-medium text-brand-500 hover:text-brand-400">
                Register here
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
