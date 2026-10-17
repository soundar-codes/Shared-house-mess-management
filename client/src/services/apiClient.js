export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

/**
 * Builds a complete URL by prepending VITE_API_BASE_URL (if configured) to the given path.
 * If VITE_API_BASE_URL is not set or empty, returns the relative path for local proxy usage.
 *
 * @param {string} path - The API endpoint path (e.g. '/api/v1/auth/me')
 * @returns {string} The resolved request URL
 */
export function apiUrl(path = '') {
  if (!path) return API_BASE_URL || '';
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

/**
 * Fetch wrapper that:
 * 1. Resolves relative endpoints using VITE_API_BASE_URL
 * 2. Defaults `credentials: 'include'` for cross-origin cookie and session support
 * 3. Preserves all standard RequestInit options
 *
 * @param {string} path - The endpoint path or full URL
 * @param {RequestInit} [options={}] - Standard fetch options
 * @returns {Promise<Response>}
 */
export function apiFetch(path, options = {}) {
  const url = apiUrl(path);
  return fetch(url, {
    ...options,
    credentials: options.credentials || 'include'
  });
}

export default apiFetch;
