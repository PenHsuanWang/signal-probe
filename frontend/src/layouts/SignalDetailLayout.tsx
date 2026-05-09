import { NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Waves } from 'lucide-react';

/**
 * Wrapper layout for /signals/:id routes.
 * Renders a tab bar (Preview | Analysis) and an <Outlet> for child pages.
 * Query params (?t0=&t1=) are preserved when switching tabs so the time
 * window set on the Preview page carries through to the Analysis page.
 */
export default function SignalDetailLayout() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';

  return (
    <div>
      {/* Tab bar */}
      <div
        className="flex border-b mb-6"
        role="tablist"
        aria-label="Signal detail sections"
        style={{ borderColor: 'var(--sp-border)' }}
      >
        <NavLink
          to={`/signals/${id}${qs}`}
          end
          role="tab"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-sans font-semibold border-b-2 transition-colors -mb-px select-none ${
              isActive
                ? 'border-brand-400 text-brand-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`
          }
          aria-label="Signal Preview tab"
        >
          <Activity size={13} aria-hidden="true" />
          Preview
        </NavLink>

        <NavLink
          to={`/signals/${id}/analysis${qs}`}
          role="tab"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-sans font-semibold border-b-2 transition-colors -mb-px select-none ${
              isActive
                ? 'border-brand-400 text-brand-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`
          }
          aria-label="Frequency Analysis tab"
        >
          <Waves size={13} aria-hidden="true" />
          Analysis
        </NavLink>
      </div>

      <Outlet />
    </div>
  );
}
