import { describe, it, expect } from 'vitest';
import { parsePlotlyDate } from './dateUtils';

// t0EpochS for "2026-04-20 00:00:00 UTC"
const T0 = 1776643200; // Apr 20, 2026 00:00:00 UTC

describe('parsePlotlyDate', () => {
  it('handles numeric epoch-ms input', () => {
    // T0 in epoch-ms → elapsed = 0
    expect(parsePlotlyDate(T0 * 1000, T0)).toBeCloseTo(0, 3);
  });

  it('handles ISO-8601 string with Z suffix (already UTC)', () => {
    // "2026-04-20T00:00:00.000Z" → 0 elapsed seconds
    expect(parsePlotlyDate('2026-04-20T00:00:00.000Z', T0)).toBeCloseTo(0, 3);
  });

  it('handles ISO-8601 string with +HH:MM offset (already UTC-normalised)', () => {
    // "2026-04-20T08:00:00.000+08:00" = 2026-04-20T00:00:00Z → 0 elapsed
    expect(parsePlotlyDate('2026-04-20T08:00:00.000+08:00', T0)).toBeCloseTo(0, 3);
  });

  it('treats space-separated string WITHOUT timezone as UTC (the Plotly bug case)', () => {
    // Plotly returns "YYYY-MM-DD HH:MM:SS.mmm" without timezone.
    // Without 'Z' appended, new Date() would parse as LOCAL time in non-UTC
    // locales. parsePlotlyDate must force UTC by appending 'Z'.
    // "2026-04-20 00:00:00.000" → should be 0 elapsed seconds regardless of
    // the machine's local timezone.
    expect(parsePlotlyDate('2026-04-20 00:00:00.000', T0)).toBeCloseTo(0, 3);
  });

  it('handles T-separator string WITHOUT timezone as UTC', () => {
    // "2026-04-20T00:00:00.000" (T already present, no Z) → same as above
    expect(parsePlotlyDate('2026-04-20T00:00:00.000', T0)).toBeCloseTo(0, 3);
  });

  it('converts positive elapsed time correctly', () => {
    // 15360 s = 4h 16m → "2026-04-20 04:16:00.000 UTC"
    const expected = 15360;
    const dateStr = '2026-04-20 04:16:00.000';
    expect(parsePlotlyDate(dateStr, T0)).toBeCloseTo(expected, 0);
  });

  it('converts end-of-day time correctly', () => {
    // 86400 s = 24h → "2026-04-21 00:00:00.000 UTC"
    expect(parsePlotlyDate('2026-04-21 00:00:00.000', T0)).toBeCloseTo(86400, 0);
  });
});
