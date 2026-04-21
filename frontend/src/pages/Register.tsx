import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Activity } from 'lucide-react';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await api.post('/auth/register', {
        email,
        password,
      });

      // Redirect to login after successful registration
      navigate('/login');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((d: any) => d.msg).filter(Boolean).join('; ') || 'Failed to register');
      } else {
        setError(detail || 'Failed to register');
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
          Create a new account
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
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full appearance-none rounded-md px-3 py-2 font-sans text-sm focus:border-brand-500 focus:outline-none focus:ring-brand-500"
                  style={{ border: '1px solid var(--sp-border)', background: 'var(--sp-surface-elevated)', color: 'var(--sp-text-primary)' }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium font-sans" style={{ color: 'var(--sp-text-primary)' }}>
                Confirm password
              </label>
              <div className="mt-1">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                {isLoading ? 'Registering…' : 'Register'}
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
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-brand-500 hover:text-brand-400">
                Sign in instead
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
