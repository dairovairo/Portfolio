import { createContext, useContext, useState, useCallback } from 'react';

const SettingsContext = createContext(null);

const STORAGE_KEYS = {
  chatWallpaper: 'sb-chat-wallpaper',
  myBubbleColor: 'sb-my-bubble-color',
  myBubbleOpacity: 'sb-my-bubble-opacity',
  otherBubbleColor: 'sb-other-bubble-color',
  otherBubbleOpacity: 'sb-other-bubble-opacity',
};

function loadStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch { return fallback; }
}

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function SettingsProvider({ children }) {
  // Personal chat wallpaper (shared for all personal chats)
  const [chatWallpaper, setChatWallpaperState] = useState(
    () => loadStorage(STORAGE_KEYS.chatWallpaper, null)
  );

  // My bubble colour
  const [myBubbleColor, setMyBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.myBubbleColor, '#7c3aed')
  );
  const [myBubbleOpacity, setMyBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.myBubbleOpacity, '1'))
  );

  // Other people's bubble colour
  const [otherBubbleColor, setOtherBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.otherBubbleColor, '#1e1e2e')
  );
  const [otherBubbleOpacity, setOtherBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.otherBubbleOpacity, '1'))
  );

  // ── setters ──────────────────────────────────────────────────────────────

  const setChatWallpaper = useCallback((dataUrl) => {
    try { localStorage.setItem(STORAGE_KEYS.chatWallpaper, dataUrl ?? ''); } catch {}
    setChatWallpaperState(dataUrl || null);
  }, []);

  const setMyBubbleColor = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.myBubbleColor, hex);
    setMyBubbleColorState(hex);
  }, []);

  const setMyBubbleOpacity = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.myBubbleOpacity, String(v));
    setMyBubbleOpacityState(v);
  }, []);

  const setOtherBubbleColor = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.otherBubbleColor, hex);
    setOtherBubbleColorState(hex);
  }, []);

  const setOtherBubbleOpacity = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.otherBubbleOpacity, String(v));
    setOtherBubbleOpacityState(v);
  }, []);

  // ── group wallpaper helpers ───────────────────────────────────────────────

  const getGroupWallpaper = useCallback((groupId) => {
    try { return localStorage.getItem(`sb-group-wp-${groupId}`) || null; } catch { return null; }
  }, []);

  const setGroupWallpaper = useCallback((groupId, dataUrl) => {
    try {
      if (dataUrl) localStorage.setItem(`sb-group-wp-${groupId}`, dataUrl);
      else localStorage.removeItem(`sb-group-wp-${groupId}`);
    } catch {}
  }, []);

  // ── derived ───────────────────────────────────────────────────────────────

  const myBubbleStyle = {
    backgroundColor: myBubbleOpacity < 1
      ? hexToRgba(myBubbleColor, myBubbleOpacity)
      : myBubbleColor,
  };

  const otherBubbleStyle = {
    backgroundColor: otherBubbleOpacity < 1
      ? hexToRgba(otherBubbleColor, otherBubbleOpacity)
      : otherBubbleColor,
  };

  return (
    <SettingsContext.Provider value={{
      // personal wallpaper
      chatWallpaper, setChatWallpaper,
      // group wallpapers
      getGroupWallpaper, setGroupWallpaper,
      // bubble colours
      myBubbleColor, setMyBubbleColor,
      myBubbleOpacity, setMyBubbleOpacity,
      otherBubbleColor, setOtherBubbleColor,
      otherBubbleOpacity, setOtherBubbleOpacity,
      // derived styles
      myBubbleStyle, otherBubbleStyle,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be inside SettingsProvider');
  return ctx;
};
