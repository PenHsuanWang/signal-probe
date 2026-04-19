import { Layers, Clock, Sliders, GitBranch } from 'lucide-react';

const FEATURES = [
  {
    icon: Layers,
    label: 'Channel Grouping',
    desc: 'Bundle multiple signal channels from different uploads into a named group for comparative analysis.',
  },
  {
    icon: GitBranch,
    label: 'Multi-Channel View',
    desc: 'Display all channels in a group as synchronized, stacked waveforms with individual Y-axis scaling.',
  },
  {
    icon: Clock,
    label: 'Time Alignment',
    desc: 'Set a reference channel and define per-channel time offsets to align signals captured at different clock rates.',
  },
  {
    icon: Sliders,
    label: 'Channel Config',
    desc: 'Assign display colors, scaling factors, and visibility toggles to each channel within the group.',
  },
];

export default function GroupsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">

      {/* Header */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <Layers size={20} className="text-brand-500" />
          <h1 className="text-sm font-bold font-mono text-zinc-100 tracking-widest uppercase">Groups</h1>
        </div>
        <p className="text-xs font-mono text-zinc-500 leading-relaxed">
          Organize multi-channel signals into groups for synchronized analysis and time alignment.
        </p>
      </div>

      {/* Coming soon */}
      <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-lg p-10 text-center space-y-3">
        <Layers size={36} className="text-zinc-700 mx-auto" />
        <p className="text-sm font-mono font-bold text-zinc-400 tracking-widest uppercase">Coming Soon</p>
        <p className="text-xs font-mono text-zinc-600 max-w-sm mx-auto leading-relaxed">
          The Groups feature enables multi-channel time-series analysis with signal alignment and
          synchronized crosshair navigation across all channels.
        </p>
      </div>

      {/* Feature preview */}
      <div>
        <p className="text-[10px] font-mono font-bold text-zinc-600 uppercase tracking-widest mb-3">
          Planned Features
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2 opacity-50"
            >
              <div className="flex items-center gap-2">
                <Icon size={14} className="text-brand-500 flex-shrink-0" />
                <p className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-widest">{label}</p>
              </div>
              <p className="text-xs font-mono text-zinc-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
