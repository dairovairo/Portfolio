import { supabase } from './supabase';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// ── Session cache ─────────────────────────────────────────────────────────────
// supabase.auth.getSession() makes a network round-trip to /auth/v1/user on
// every call, which was generating 1000+ requests to Supabase just for auth.
// We cache the session in memory and only refresh it when:
//   1. It doesn't exist yet (first call / page load)
//   2. The token is within 60 s of expiry (proactive refresh)
//   3. The server returns 401 (reactive refresh)
// supabase.auth.onAuthStateChange keeps the cache in sync whenever the SDK
// refreshes the token automatically.

let _cachedSession = null;
let _sessionPromise = null; // deduplicates concurrent initial fetches

supabase.auth.onAuthStateChange((_event, session) => {
  _cachedSession = session;
  _sessionPromise = null; // invalidate any in-flight promise
});

async function getSessionCached() {
  // Already have a valid session with >60s left — return immediately, no network call
  if (_cachedSession?.access_token) {
    const exp = _cachedSession.expires_at; // unix seconds
    if (!exp || exp - Date.now() / 1000 > 60) {
      return _cachedSession;
    }
  }

  // Deduplicate: if another call is already fetching the session, wait for it
  if (!_sessionPromise) {
    _sessionPromise = supabase.auth.getSession().then(({ data }) => {
      _cachedSession = data.session ?? null;
      _sessionPromise = null;
      return _cachedSession;
    });
  }

  return _sessionPromise;
}

// ── apiFetch ──────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}, retries = 3) {
  const method = options.method || 'GET';
  const canRetry = method === 'GET' || method === 'HEAD';
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  // Get token from cache — only hits the network when the cache is cold or expiring
  let session = await getSessionCached();

  // If still no session, wait briefly (handles the race at app startup)
  if (!session) {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 500));
      session = await getSessionCached();
      if (session) break;
    }
  }

  const token = session?.access_token;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: isFormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkErr) {
    if (canRetry && retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return apiFetch(path, options, retries - 1);
    }
    throw new Error('No se pudo conectar con el servidor. Inténtalo de nuevo.');
  }

  // 401 → token may have just expired; force a real refresh and retry once
  if (res.status === 401 && retries > 0) {
    _cachedSession = null;
    _sessionPromise = null;
    return apiFetch(path, options, 0); // retries=0 prevents infinite loop
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_e) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body }),
  postForm: (path, formData) => apiFetch(path, { method: 'POST', body: formData }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};
