/**
 * Parse a Plotly date string or epoch-ms number into elapsed seconds from t0.
 *
 * Plotly internally formats date-axis values as `"YYYY-MM-DD HH:MM:SS.mmm"`
 * — a space-separated ISO-8601-like string WITHOUT a timezone marker.  When
 * parsed with `new Date(s)` on V8/Chrome, space-separated strings are treated
 * as LOCAL time (not UTC), causing a UTC-offset shift in locales other than
 * UTC (e.g. UTC+8 ⇒ 8 h shift).  This function normalises the string to
 * strict ISO-8601 UTC before parsing to fix that bug.
 *
 * @param d        Plotly date string ("YYYY-MM-DD HH:MM:SS.mmm") or epoch-ms
 * @param t0EpochS Unix epoch seconds of the signal's first sample (t=0)
 * @returns        Elapsed seconds from the signal start (same coordinate as
 *                 `timestamp_s` in the Parquet / `MacroViewResponse.x`)
 */
export function parsePlotlyDate(d: string | number, t0EpochS: number): number {
  let ms: number;
  if (typeof d === 'number') {
    // Plotly can return epoch-ms as a raw number for date axes.
    ms = d;
  } else {
    // Normalise to strict ISO-8601 UTC: replace space separator with 'T' then
    // append 'Z' if no timezone marker is already present.
    const s = String(d).trim();
    const withT = s.includes('T') ? s : s.replace(' ', 'T');
    const utc = /[Zz]$|[+-]\d\d:\d\d$/.test(withT) ? withT : withT + 'Z';
    ms = new Date(utc).getTime();
  }
  return ms / 1000 - t0EpochS;
}
