import type { Theme } from '../context/ThemeContext';

/**
 * Publication-safe channel color palette.
 * Based on Matplotlib tab10 with IBM colorblind-safe adjustments.
 * Distinguishable in grayscale print and for the most common forms of
 * color vision deficiency (deuteranopia, protanopia).
 */
export const SCIENTIFIC_PALETTE: string[] = [
  '#1f77b4', // muted blue
  '#ff7f0e', // safety orange
  '#2ca02c', // cooked asparagus green
  '#d62728', // brick red
  '#9467bd', // muted purple
  '#8c564b', // chestnut brown
  '#e377c2', // raspberry yogurt pink
  '#7f7f7f', // middle gray
];

export const scientificColor = (i: number): string =>
  SCIENTIFIC_PALETTE[i % SCIENTIFIC_PALETTE.length];

// ── Shared axis config ────────────────────────────────────────────────────────

const LIGHT_AXIS = {
  color: '#1a1a1a',
  gridcolor: 'rgba(0,0,0,0.10)',
  showgrid: true,
  griddash: 'dash' as const,
  zerolinecolor: '#1a1a1a',
  zerolinewidth: 1,
  ticks: 'inside' as const,
  ticklen: 5,
  tickcolor: '#1a1a1a',
  tickfont: { size: 11, family: 'Inter, ui-sans-serif, sans-serif', color: '#1a1a1a' },
  linecolor: '#1a1a1a',
  linewidth: 1,
  showline: true,
  mirror: true,
} as const;

const DARK_AXIS = {
  color: '#9ca3af',
  gridcolor: 'rgba(255,255,255,0.05)',
  showgrid: true,
  griddash: 'dash' as const,
  zerolinecolor: '#6b7280',
  zerolinewidth: 1,
  ticks: 'inside' as const,
  ticklen: 4,
  tickcolor: '#6b7280',
  tickfont: { size: 11, family: 'Inter, ui-sans-serif, sans-serif', color: '#9ca3af' },
  linecolor: '#4b5563',
  linewidth: 1,
  showline: true,
} as const;

// ── buildChartTheme ───────────────────────────────────────────────────────────

/**
 * Returns a Plotly partial Layout config matching the active UI theme.
 * Use this as the base for every chart layout object in the application.
 *
 * @example
 * const layout = { ...buildChartTheme(theme), margin: { t: 8, r: 12, l: 52, b: 60 } };
 */
export function buildChartTheme(theme: Theme): Partial<Plotly.Layout> {
  const isLight = theme === 'light';

  const axis = isLight ? LIGHT_AXIS : DARK_AXIS;

  return {
    paper_bgcolor: isLight ? '#ffffff' : 'transparent',
    plot_bgcolor: isLight ? '#f5f5f5' : 'transparent',
    font: {
      family: 'Inter, ui-sans-serif, sans-serif',
      color: isLight ? '#1a1a1a' : '#9ca3af',
      size: 12,
    },
    xaxis: { ...axis },
    yaxis: { ...axis },
    hovermode: 'x unified' as const,
    showlegend: false,
  };
}
