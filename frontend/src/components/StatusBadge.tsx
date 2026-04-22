import { RefreshCw, Settings, Clock, CheckCircle, XCircle } from 'lucide-react';
import type { SignalMetadata } from '../types/signal';

export interface StatusBadgeProps {
  /** Current processing status of the signal. */
  status: SignalMetadata['status'];
  /** Visual variant: 'pill' (default) for tables, 'inline' for inline text. */
  variant?: 'pill' | 'inline';
  className?: string;
}

const STATUS_CONFIG: Record<
  SignalMetadata['status'],
  { color: string; bg: string; label: string; icon: React.ReactNode }
> = {
  AWAITING_CONFIG: {
    color: 'text-purple-400',
    bg:    'bg-purple-400/10',
    label: 'Configure',
    icon:  <Settings size={9} aria-hidden="true" />,
  },
  PENDING: {
    color: 'text-yellow-400',
    bg:    'bg-yellow-400/10',
    label: 'Pending',
    icon:  <Clock size={9} aria-hidden="true" />,
  },
  PROCESSING: {
    color: 'text-blue-400',
    bg:    'bg-blue-400/10',
    label: 'Processing',
    icon:  <RefreshCw size={9} className="animate-spin" aria-hidden="true" />,
  },
  COMPLETED: {
    color: 'text-green-400',
    bg:    'bg-green-400/10',
    label: 'Completed',
    icon:  <CheckCircle size={9} aria-hidden="true" />,
  },
  FAILED: {
    color: 'text-red-400',
    bg:    'bg-red-400/10',
    label: 'Failed',
    icon:  <XCircle size={9} aria-hidden="true" />,
  },
};

/**
 * StatusBadge — displays a signal's processing status as a colour-coded badge.
 *
 * @example
 * <StatusBadge status="AWAITING_CONFIG" />
 * <StatusBadge status="COMPLETED" variant="inline" />
 */
export function StatusBadge({ status, variant = 'pill', className = '' }: StatusBadgeProps) {
  const { color, bg, label, icon } = STATUS_CONFIG[status];

  if (variant === 'inline') {
    return (
      <span
        className={`flex items-center gap-1 text-xs font-mono ${color} ${className}`}
        role="status"
        aria-label={`Status: ${label}`}
      >
        {icon}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-semibold ${color} ${bg} ${className}`}
      role="status"
      aria-label={`Status: ${label}`}
    >
      {icon}
      {label}
    </span>
  );
}

export default StatusBadge;
