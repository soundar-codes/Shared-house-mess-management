import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiUrl, apiFetch, API_BASE_URL } from './apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' })
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('apiUrl resolves relative paths when base URL is empty', () => {
    expect(apiUrl('/api/v1/auth/me')).toBe('/api/v1/auth/me');
    expect(apiUrl('api/v1/auth/me')).toBe('/api/v1/auth/me');
  });

  it('apiUrl preserves absolute http/https URLs', () => {
    expect(apiUrl('https://example.com/api/v1/test')).toBe('https://example.com/api/v1/test');
    expect(apiUrl('http://example.com/api/v1/test')).toBe('http://example.com/api/v1/test');
  });

  it('apiFetch defaults credentials to include', async () => {
    await apiFetch('/api/v1/test');
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/test', expect.objectContaining({
      credentials: 'include'
    }));
  });

  it('apiFetch passes method, headers, and body properly', async () => {
    await apiFetch('/api/v1/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'val' })
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'val' }),
      credentials: 'include'
    });
  });

  it('apiFetch preserves custom credentials setting if explicitly provided', async () => {
    await apiFetch('/api/v1/test', { credentials: 'same-origin' });
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/test', expect.objectContaining({
      credentials: 'same-origin'
    }));
  });
});
