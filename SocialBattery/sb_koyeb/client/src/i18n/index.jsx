// ─────────────────────────────────────────────────────────────────────────────
// Sistema de internacionalización (i18n) — mini contexto propio, sin depender
// de librerías externas para no inflar el bundle (react-i18next añade ~40 KB
// gzipped y aquí no lo justificamos: son 3 idiomas y unos cientos de claves).
//
// Cómo funciona:
//   • Diccionarios planos-anidados en src/i18n/locales/{es,en,fr}.js.
//   • `useTranslation()` devuelve `{ t, lang, setLang, availableLangs }`.
//   • `t('foo.bar', { name: 'Io' })` — busca la clave "foo.bar" en el idioma
//     activo; si falta, cae a español (source of truth); si tampoco existe,
//     devuelve la propia clave (para detectarlo visualmente en desarrollo).
//   • La preferencia se guarda en localStorage (`sb-lang`) para lectura
//     inmediata en el próximo arranque, y se sincroniza con el servidor
//     (users.preferred_language) desde AuthContext cuando hay sesión — así
//     el idioma viaja entre dispositivos.
//   • En el primer arranque (sin preferencia guardada, sin perfil todavía)
//     se autodetecta el idioma del navegador entre los soportados; si no
//     coincide, cae a español.
//
// Nota importante: NO usamos aquí `import { api }` ni ningún side-effect
// contra el servidor. El PATCH /users/me lo hace el consumidor (SettingsPage)
// para no acoplar el provider a la capa de red y para que este archivo pueda
// montarse antes que AuthProvider en el árbol.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import es from './locales/es';
import en from './locales/en';
import fr from './locales/fr';

const DICTS = { es, en, fr };
const DEFAULT_LANG = 'es';
const AVAILABLE = /** @type {const} */ (['es', 'en', 'fr']);
const STORAGE_KEY = 'sb-lang';

// Etiquetas que se muestran en el propio selector — se dejan en su idioma
// nativo para que "English" siga apareciendo como "English" incluso cuando
// la app está en español (patrón habitual, cf. Discord/Notion).
export const LANGUAGE_LABELS = {
  es: 'Español',
  en: 'English',
  fr: 'Français',
};

// Emoji-bandera representativa. No usamos la del país (🇪🇸 🇬🇧 🇫🇷) porque
// asocia idioma a país (los hispanohablantes no viven todos en España). El
// globo terráqueo es neutro y funciona para cualquier locale que añadamos
// después. Se mantiene por si se quiere pintar en el selector.
export const LANGUAGE_FLAGS = {
  es: '🌐',
  en: '🌐',
  fr: '🌐',
};

// ── helpers puros ────────────────────────────────────────────────────────────

function normalizeLang(raw) {
  if (typeof raw !== 'string') return null;
  // "en-US" → "en", "fr_CA" → "fr", "es-419" → "es". Aceptamos los prefijos
  // que soportamos y descartamos el resto.
  const prefix = raw.trim().toLowerCase().split(/[-_]/)[0];
  return AVAILABLE.includes(prefix) ? prefix : null;
}

function detectFromBrowser() {
  if (typeof navigator === 'undefined') return DEFAULT_LANG;
  // navigator.languages viene ordenado por preferencia del usuario. Cogemos
  // el primero que soportemos; si ninguno coincide, español.
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
  for (const c of candidates) {
    const norm = normalizeLang(c);
    if (norm) return norm;
  }
  return DEFAULT_LANG;
}

function readStoredLang() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeLang(raw);
  } catch { return null; }
}

// Accede a "a.b.c" dentro de un objeto anidado. Si algún tramo falla, null.
function lookup(dict, path) {
  if (!dict) return null;
  const parts = path.split('.');
  let cur = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return null;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : null;
}

// "Hola {name}" + { name: 'Io' } → "Hola Io". Sin dependencias, no soporta
// pluralización compleja (para "1 seleccionado" vs "N seleccionados" tenemos
// claves distintas y el consumidor elige — ver interestsSelectedOne/Many).
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

// ── contexto + hook ──────────────────────────────────────────────────────────

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => readStoredLang() || detectFromBrowser());

  // Persistir en localStorage y en <html lang="…"> — esto último ayuda a
  // que lectores de pantalla, el corrector del navegador y el propio Google
  // OAuth consent screen elijan el idioma correcto de las páginas públicas.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', lang);
    }
  }, [lang]);

  const setLang = useCallback((next) => {
    const norm = normalizeLang(next);
    if (norm) setLangState(norm);
  }, []);

  // Hidrata desde el perfil del servidor. Se llama desde AuthContext en
  // cuanto tenemos `profile.preferred_language`. No sobreescribe si el
  // valor del servidor es null (usuarios pre-fase132) — nos quedamos con
  // el elegido localmente / autodetectado.
  const hydrateFromProfile = useCallback((profile) => {
    if (!profile) return;
    const norm = normalizeLang(profile.preferred_language);
    if (norm) setLangState(norm);
  }, []);

  const t = useCallback((key, params) => {
    const active = lookup(DICTS[lang], key);
    if (active != null) return interpolate(active, params);
    // Fallback: español. Si tampoco existe, devolvemos la propia clave —
    // así en desarrollo salta a la vista si nos falta traducir algo.
    const fallback = lookup(DICTS[DEFAULT_LANG], key);
    if (fallback != null) return interpolate(fallback, params);
    return key;
  }, [lang]);

  const value = useMemo(() => ({
    lang,
    setLang,
    hydrateFromProfile,
    availableLangs: AVAILABLE,
    t,
  }), [lang, setLang, hydrateFromProfile, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useTranslation must be used inside LanguageProvider');
  return ctx;
}
