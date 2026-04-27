/**
 * Unit tests for api.ts — fetchSTFT and fetchSpectrogram.
 *
 * Regression coverage for hotfix/fft-fetch-params:
 *   - fetchSTFT must pass params as an STFTParams *object*, NOT as individual
 *     positional arguments.  The production incident (commit fbaf663) broke FFT
 *     by refactoring the call site to pass a string as the second argument to
 *     fetchSTFT, causing axios to throw "TypeError: target must be an object"
 *     when building query params.
 *
 * Additional coverage:
 *   - The correct URL path is constructed from signalId
 *   - The AbortSignal is forwarded to axios
 *   - fetchSpectrogram passes SpectrogramParams as an object
 *   - Axios errors are propagated (not swallowed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { STFTResponse, SpectrogramResponse } from '../types/signal';
import { fetchSTFT, fetchSpectrogram, api } from './api';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const MOCK_STFT_RESPONSE: STFTResponse = {
  signal_id: 'sig-abc',
  channel_name: 'ch1',
  frequencies_hz: [0, 50, 100],
  magnitudes: [0.1, 0.8, 0.2],
  dominant_frequency_hz: 50,
  window_config: { start_s: 0, end_s: 1, window_fn: 'hann', window_size: 256 },
  sampling_rate_hz: 1000,
};

const MOCK_SPECTROGRAM_RESPONSE: SpectrogramResponse = {
  signal_id: 'sig-abc',
  channel_name: 'ch1',
  time_bins_s: [0.128, 0.256],
  frequency_bins_hz: [0, 50, 100],
  magnitude_db: [[-10, -5, -20], [-12, -6, -18]],
  sampling_rate_hz: 1000,
  downsampled: false,
};

let getSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getSpy = vi.spyOn(api, 'get');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── fetchSTFT ─────────────────────────────────────────────────────────────────

describe('fetchSTFT', () => {
  it('passes params as an STFTParams object — regression for hotfix/fft-fetch-params', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_STFT_RESPONSE });

    await fetchSTFT('sig-abc', {
      channel_name: 'ch1',
      start_s: 0.5,
      end_s: 1.5,
      window_fn: 'hann',
      window_size: 256,
    });

    expect(getSpy).toHaveBeenCalledOnce();
    const [, config] = getSpy.mock.calls[0];

    // The second axios config argument must carry `params` as an object,
    // NOT a string. This is the exact invariant that was broken in fbaf663.
    expect(typeof config?.params).toBe('object');
    expect(config?.params).toEqual(
      expect.objectContaining({
        channel_name: 'ch1',
        start_s: 0.5,
        end_s: 1.5,
        window_fn: 'hann',
        window_size: 256,
      }),
    );
  });

  it('builds the correct URL from signalId', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_STFT_RESPONSE });

    await fetchSTFT('my-signal-id', { channel_name: 'ch1', start_s: 0, end_s: 1 });

    const [url] = getSpy.mock.calls[0];
    expect(url).toBe('/signals/my-signal-id/analysis/stft');
  });

  it('forwards the AbortSignal to axios', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_STFT_RESPONSE });

    const ac = new AbortController();
    await fetchSTFT(
      'sig-abc',
      { channel_name: 'ch1', start_s: 0, end_s: 1 },
      ac.signal,
    );

    const [, config] = getSpy.mock.calls[0];
    expect(config?.signal).toBe(ac.signal);
  });

  it('returns the response data directly', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_STFT_RESPONSE });

    const result = await fetchSTFT('sig-abc', {
      channel_name: 'ch1',
      start_s: 0,
      end_s: 1,
    });

    expect(result).toEqual(MOCK_STFT_RESPONSE);
    expect(result.sampling_rate_hz).toBe(1000);
  });

  it('propagates axios errors to the caller', async () => {
    const err = new Error('Network Error');
    getSpy.mockRejectedValueOnce(err);

    await expect(
      fetchSTFT('sig-abc', { channel_name: 'ch1', start_s: 0, end_s: 1 }),
    ).rejects.toThrow('Network Error');
  });

  it('works with only required params (window_fn and window_size are optional)', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_STFT_RESPONSE });

    await fetchSTFT('sig-abc', { channel_name: 'ch1', start_s: 0, end_s: 1 });

    const [, config] = getSpy.mock.calls[0];
    expect(config?.params).toEqual({ channel_name: 'ch1', start_s: 0, end_s: 1 });
  });

  it('does NOT pass channel as a bare string (direct regression guard)', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_STFT_RESPONSE });

    await fetchSTFT('sig-abc', { channel_name: 'voltage', start_s: 0, end_s: 2 });

    const [, config] = getSpy.mock.calls[0];
    // If params were accidentally passed as a bare string the typeof would be
    // 'string' and axios would throw "target must be an object" at runtime.
    expect(typeof config?.params).not.toBe('string');
    expect(typeof config?.params).not.toBe('number');
  });
});

// ── fetchSpectrogram ──────────────────────────────────────────────────────────

describe('fetchSpectrogram', () => {
  it('passes params as a SpectrogramParams object', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_SPECTROGRAM_RESPONSE });

    await fetchSpectrogram('sig-abc', {
      channel_name: 'ch1',
      window_fn: 'hamming',
      window_size: 512,
      hop_size: 256,
    });

    const [, config] = getSpy.mock.calls[0];
    expect(typeof config?.params).toBe('object');
    expect(config?.params).toEqual(
      expect.objectContaining({ channel_name: 'ch1', window_size: 512 }),
    );
  });

  it('builds the correct URL from signalId', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_SPECTROGRAM_RESPONSE });

    await fetchSpectrogram('my-signal-id', { channel_name: 'ch1' });

    const [url] = getSpy.mock.calls[0];
    expect(url).toBe('/signals/my-signal-id/analysis/spectrogram');
  });

  it('forwards the AbortSignal to axios', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_SPECTROGRAM_RESPONSE });

    const ac = new AbortController();
    await fetchSpectrogram('sig-abc', { channel_name: 'ch1' }, ac.signal);

    const [, config] = getSpy.mock.calls[0];
    expect(config?.signal).toBe(ac.signal);
  });

  it('returns the response data directly', async () => {
    getSpy.mockResolvedValueOnce({ data: MOCK_SPECTROGRAM_RESPONSE });

    const result = await fetchSpectrogram('sig-abc', { channel_name: 'ch1' });
    expect(result.downsampled).toBe(false);
    expect(result.frequency_bins_hz).toHaveLength(3);
  });

  it('propagates axios errors to the caller', async () => {
    getSpy.mockRejectedValueOnce(new Error('500 Internal Server Error'));

    await expect(
      fetchSpectrogram('sig-abc', { channel_name: 'ch1' }),
    ).rejects.toThrow('500 Internal Server Error');
  });
});
