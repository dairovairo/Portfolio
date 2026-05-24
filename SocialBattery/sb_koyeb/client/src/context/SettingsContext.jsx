import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../lib/api';

const SettingsContext = createContext(null);

// ── Defaults ──────────────────────────────────────────────────────────────────
export const SETTINGS_DEFAULTS_DARK = {
  myBubbleColor:       '#1a5c3a',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#d1fae5',
  otherBubbleColor:    '#1e293b',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#e2e8f0',
  tickColorSent:       '#ffffff',  // blanco por defecto
  tickColorUnread:     '#ffffff',  // blanco por defecto — doble tick entregado
  tickColorRead:       '#ffffff',  // blanco por defecto — doble tick leído
};

export const SETTINGS_DEFAULTS_LIGHT = {
  myBubbleColor:       '#16a34a',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#ffffff',
  otherBubbleColor:    '#f1f5f9',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#1e293b',
  tickColorSent:       '#ffffff',  // blanco por defecto
  tickColorUnread:     '#ffffff',  // blanco por defecto — doble tick entregado
  tickColorRead:       '#ffffff',  // blanco por defecto — doble tick leído
};

export const SETTINGS_DEFAULTS = SETTINGS_DEFAULTS_DARK;

const STORAGE_KEYS = {
  chatWallpaper:         'sb-chat-wallpaper',
  myBubbleColor:         'sb-my-bubble-color',
  myBubbleOpacity:       'sb-my-bubble-opacity',
  myBubbleTextColor:     'sb-my-bubble-text-color',
  otherBubbleColor:      'sb-other-bubble-color',
  otherBubbleOpacity:    'sb-other-bubble-opacity',
  otherBubbleTextColor:  'sb-other-bubble-text-color',
  tickColorSent:         'sb-tick-color-sent',
  tickColorUnread:       'sb-tick-color-unread',
  tickColorRead:         'sb-tick-color-read',
  // notifications
  muteBatteryChanges:    'sb-mute-battery-changes',
  muteAllNotifications:  'sb-mute-all-notifications',
  mutePersonalChats:     'sb-mute-personal-chats',
  muteGroupChats:        'sb-mute-group-chats',
  // privacy
  readReceipts:          'sb-read-receipts',
  showOnline:            'sb-show-online',
  showLastSeen:          'sb-show-last-seen',
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

// Sincroniza preferencias de privacidad con el servidor (sin bloquear)
function syncPrivacy(updates) {
  api.patch('/users/me/privacy', updates).catch(() => {});
}

export function SettingsProvider({ children }) {
  const [chatWallpaper, setChatWallpaperState] = useState(
    () => loadStorage(STORAGE_KEYS.chatWallpaper, null)
  );

  const [myBubbleColor, setMyBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.myBubbleColor, SETTINGS_DEFAULTS.myBubbleColor)
  );
  const [myBubbleOpacity, setMyBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.myBubbleOpacity, String(SETTINGS_DEFAULTS.myBubbleOpacity)))
  );
  const [myBubbleTextColor, setMyBubbleTextColorState] = useState(
    () => loadStorage(STORAGE_KEYS.myBubbleTextColor, SETTINGS_DEFAULTS.myBubbleTextColor)
  );

  const [otherBubbleColor, setOtherBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.otherBubbleColor, SETTINGS_DEFAULTS.otherBubbleColor)
  );
  const [otherBubbleOpacity, setOtherBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.otherBubbleOpacity, String(SETTINGS_DEFAULTS.otherBubbleOpacity)))
  );
  const [otherBubbleTextColor, setOtherBubbleTextColorState] = useState(
    () => loadStorage(STORAGE_KEYS.otherBubbleTextColor, SETTINGS_DEFAULTS.otherBubbleTextColor)
  );

  const [tickColorSent, setTickColorSentState] = useState(
    () => loadStorage(STORAGE_KEYS.tickColorSent, SETTINGS_DEFAULTS.tickColorSent)
  );
  const [tickColorUnread, setTickColorUnreadState] = useState(
    () => loadStorage(STORAGE_KEYS.tickColorUnread, SETTINGS_DEFAULTS.tickColorUnread)
  );
  const [tickColorRead, setTickColorReadState] = useState(
    () => loadStorage(STORAGE_KEYS.tickColorRead, SETTINGS_DEFAULTS.tickColorRead)
  );

  // ── Notification preferences ──────────────────────────────────────────────
  const [muteBatteryChanges, setMuteBatteryChangesState] = useState(
    () => loadStorage(STORAGE_KEYS.muteBatteryChanges, 'false') === 'true'
  );
  const [muteAllNotifications, setMuteAllNotificationsState] = useState(
    () => loadStorage(STORAGE_KEYS.muteAllNotifications, 'false') === 'true'
  );
  const [mutePersonalChats, setMutePersonalChatsState] = useState(
    () => loadStorage(STORAGE_KEYS.mutePersonalChats, 'false') === 'true'
  );
  const [muteGroupChats, setMuteGroupChatsState] = useState(
    () => loadStorage(STORAGE_KEYS.muteGroupChats, 'false') === 'true'
  );

  // ── Privacy preferences ───────────────────────────────────────────────────
  const [readReceipts, setReadReceiptsState] = useState(
    () => loadStorage(STORAGE_KEYS.readReceipts, 'true') === 'true'
  );
  const [showOnline, setShowOnlineState] = useState(
    () => loadStorage(STORAGE_KEYS.showOnline, 'true') === 'true'
  );
  const [showLastSeen, setShowLastSeenState] = useState(
    () => loadStorage(STORAGE_KEYS.showLastSeen, 'true') === 'true'
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

  const setMyBubbleTextColor = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.myBubbleTextColor, hex);
    setMyBubbleTextColorState(hex);
  }, []);

  const setOtherBubbleColor = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.otherBubbleColor, hex);
    setOtherBubbleColorState(hex);
  }, []);

  const setOtherBubbleOpacity = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.otherBubbleOpacity, String(v));
    setOtherBubbleOpacityState(v);
  }, []);

  const setOtherBubbleTextColor = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.otherBubbleTextColor, hex);
    setOtherBubbleTextColorState(hex);
  }, []);

  const setTickColorSent = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.tickColorSent, hex);
    setTickColorSentState(hex);
  }, []);

  const setTickColorUnread = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.tickColorUnread, hex);
    setTickColorUnreadState(hex);
  }, []);

  const setTickColorRead = useCallback((hex) => {
    localStorage.setItem(STORAGE_KEYS.tickColorRead, hex);
    setTickColorReadState(hex);
  }, []);

  const setMuteBatteryChanges = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.muteBatteryChanges, String(v));
    setMuteBatteryChangesState(v);
  }, []);

  const setMuteAllNotifications = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.muteAllNotifications, String(v));
    setMuteAllNotificationsState(v);
  }, []);

  const setMutePersonalChats = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.mutePersonalChats, String(v));
    setMutePersonalChatsState(v);
  }, []);

  const setMuteGroupChats = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.muteGroupChats, String(v));
    setMuteGroupChatsState(v);
  }, []);

  // Privacy setters — sincronizan con el servidor para que otros usuarios
  // respeten estas preferencias (ej: no enviar confirmaciones de lectura,
  // ocultar última vez, no emitir presencia)
  const setReadReceipts = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.readReceipts, String(v));
    setReadReceiptsState(v);
    syncPrivacy({ read_receipts: v });
  }, []);

  const setShowOnline = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.showOnline, String(v));
    setShowOnlineState(v);
    syncPrivacy({ show_online: v });
  }, []);

  const setShowLastSeen = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.showLastSeen, String(v));
    setShowLastSeenState(v);
    syncPrivacy({ show_last_seen: v });
  }, []);

  // ── reset to defaults ─────────────────────────────────────────────────────

  const resetMessagingDefaults = useCallback(() => {
    const d = SETTINGS_DEFAULTS;
    localStorage.setItem(STORAGE_KEYS.myBubbleColor,        d.myBubbleColor);
    localStorage.setItem(STORAGE_KEYS.myBubbleOpacity,      String(d.myBubbleOpacity));
    localStorage.setItem(STORAGE_KEYS.myBubbleTextColor,    d.myBubbleTextColor);
    localStorage.setItem(STORAGE_KEYS.otherBubbleColor,     d.otherBubbleColor);
    localStorage.setItem(STORAGE_KEYS.otherBubbleOpacity,   String(d.otherBubbleOpacity));
    localStorage.setItem(STORAGE_KEYS.otherBubbleTextColor, d.otherBubbleTextColor);
    localStorage.setItem(STORAGE_KEYS.tickColorSent,        d.tickColorSent);
    localStorage.setItem(STORAGE_KEYS.tickColorUnread,      d.tickColorUnread);
    localStorage.setItem(STORAGE_KEYS.tickColorRead,        d.tickColorRead);
    setMyBubbleColorState(d.myBubbleColor);
    setMyBubbleOpacityState(d.myBubbleOpacity);
    setMyBubbleTextColorState(d.myBubbleTextColor);
    setOtherBubbleColorState(d.otherBubbleColor);
    setOtherBubbleOpacityState(d.otherBubbleOpacity);
    setOtherBubbleTextColorState(d.otherBubbleTextColor);
    setTickColorSentState(d.tickColorSent);
    setTickColorUnreadState(d.tickColorUnread);
    setTickColorReadState(d.tickColorRead);
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

  // ── derived styles ─────────────────────────────────────────────────────────

  const myBubbleStyle = {
    backgroundColor: myBubbleOpacity < 1
      ? hexToRgba(myBubbleColor, myBubbleOpacity)
      : myBubbleColor,
    color: myBubbleTextColor,
  };

  const otherBubbleStyle = {
    backgroundColor: otherBubbleOpacity < 1
      ? hexToRgba(otherBubbleColor, otherBubbleOpacity)
      : otherBubbleColor,
    color: otherBubbleTextColor,
  };

  return (
    <SettingsContext.Provider value={{
      chatWallpaper, setChatWallpaper,
      getGroupWallpaper, setGroupWallpaper,
      myBubbleColor, setMyBubbleColor,
      myBubbleOpacity, setMyBubbleOpacity,
      myBubbleTextColor, setMyBubbleTextColor,
      otherBubbleColor, setOtherBubbleColor,
      otherBubbleOpacity, setOtherBubbleOpacity,
      otherBubbleTextColor, setOtherBubbleTextColor,
      tickColorSent, setTickColorSent,
      tickColorUnread, setTickColorUnread,
      tickColorRead, setTickColorRead,
      resetMessagingDefaults,
      myBubbleStyle, otherBubbleStyle,
      muteBatteryChanges, setMuteBatteryChanges,
      muteAllNotifications, setMuteAllNotifications,
      mutePersonalChats, setMutePersonalChats,
      muteGroupChats, setMuteGroupChats,
      readReceipts, setReadReceipts,
      showOnline, setShowOnline,
      showLastSeen, setShowLastSeen,
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
