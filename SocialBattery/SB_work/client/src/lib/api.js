import { supabase } from './supabase';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function apiFetch(path, options = {}, retries = 3) {
  const method = options.method || 'GET';
  const canRetry = method === 'GET' || method === 'HEAD';

  // Si no hay sesión aún, esperar hasta 2s antes de rendirse
  let session = null;
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) { session = data.session; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  const token = session?.access_token;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkErr) {
    // Failed to fetch = servidor dormido o sin red
    if (canRetry && retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return apiFetch(path, options, retries - 1);
    }
    throw new Error('No se pudo conectar con el servidor. Inténtalo de nuevo.');
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
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};
