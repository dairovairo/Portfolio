import { createContext, useContext, useState, useCallback } from 'react';

const SettingsContext = createContext(null);

// ── Defaults ──────────────────────────────────────────────────────────────────
// Bubble colours optimised for each theme, both designed to pair nicely with
// the default blue read-tick (#1d9bf0).
export const SETTINGS_DEFAULTS_DARK = {
  myBubbleColor:       '#1a5c3a',  // dark emerald — clear contrast with blue ticks
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#d1fae5',  // soft mint text on dark green
  otherBubbleColor:    '#1e293b',  // slate-800 — distinct from #0a0a0f bg
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#e2e8f0',  // light grey text
  tickColorSent:       '#ffffff',  // blanco — tick individual (enviado, no entregado)
  tickColorUnread:     '#ffffff',  // blanco — doble tick entregado
  tickColorRead:       '#1d9bf0',  // azul — doble tick leído
};

export const SETTINGS_DEFAULTS_LIGHT = {
  myBubbleColor:       '#16a34a',  // green-600 — vibrant on light bg, pairs with blue ticks
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#ffffff',  // white text on green
  otherBubbleColor:    '#f1f5f9',  // slate-100 — soft on white bg
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#1e293b',  // dark text on light grey
  tickColorSent:       '#ffffff',  // blanco — tick individual light theme
  tickColorUnread:     '#ffffff',  // blanco — doble tick entregado light theme
  tickColorRead:       '#1d9bf0',  // azul — doble tick leído light theme
};

// Default set (dark is the app default theme)
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

export function SettingsProvider({ children }) {
  // Personal chat wallpaper (shared for all personal chats)
  const [chatWallpaper, setChatWallpaperState] = useState(
    () => loadStorage(STORAGE_KEYS.chatWallpaper, null)
  );

  // My bubble
  const [myBubbleColor, setMyBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.myBubbleColor, SETTINGS_DEFAULTS.myBubbleColor)
  );
  const [myBubbleOpacity, setMyBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.myBubbleOpacity, String(SETTINGS_DEFAULTS.myBubbleOpacity)))
  );
  const [myBubbleTextColor, setMyBubbleTextColorState] = useState(
    () => loadStorage(STORAGE_KEYS.myBubbleTextColor, SETTINGS_DEFAULTS.myBubbleTextColor)
  );

  // Other people's bubble
  const [otherBubbleColor, setOtherBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.otherBubbleColor, SETTINGS_DEFAULTS.otherBubbleColor)
  );
  const [otherBubbleOpacity, setOtherBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.otherBubbleOpacity, String(SETTINGS_DEFAULTS.otherBubbleOpacity)))
  );
  const [otherBubbleTextColor, setOtherBubbleTextColorState] = useState(
    () => loadStorage(STORAGE_KEYS.otherBubbleTextColor, SETTINGS_DEFAULTS.otherBubbleTextColor)
  );

  // Tick colours
  const [tickColorSent, setTickColorSentState] = useState(() => {
    const stored = loadStorage(STORAGE_KEYS.tickColorSent, SETTINGS_DEFAULTS.tickColorSent);
    // Migrate old grey defaults (#475569 / #64748b) to current white default
    if (stored === '#475569' || stored === '#64748b') return SETTINGS_DEFAULTS.tickColorSent;
    return stored;
  });
  const [tickColorUnread, setTickColorUnreadState] = useState(() => {
    const stored = loadStorage(STORAGE_KEYS.tickColorUnread, SETTINGS_DEFAULTS.tickColorUnread);
    // Migrate old grey defaults (#475569 / #64748b) to current white default
    if (stored === '#475569' || stored === '#64748b') return SETTINGS_DEFAULTS.tickColorUnread;
    return stored;
  });
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
  // readReceipts: when OFF, we don't send read_at to the server so senders
  // can't see when we've read their messages (and we hide theirs too, mutual).
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

  const setReadReceipts = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.readReceipts, String(v));
    setReadReceiptsState(v);
  }, []);

  const setShowOnline = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.showOnline, String(v));
    setShowOnlineState(v);
    // When going offline, notify server immediately so friends see us as offline
    if (!v) {
      import('../lib/api').then(({ api }) => {
        api.patch('/users/me/go-offline').catch(() => {});
      });
    }
  }, []);

  const setShowLastSeen = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.showLastSeen, String(v));
    setShowLastSeenState(v);
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

  // ── derived styles (include text color so bubbles inherit it) ─────────────

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
      // personal wallpaper
      chatWallpaper, setChatWallpaper,
      // group wallpapers
      getGroupWallpaper, setGroupWallpaper,
      // bubble colours
      myBubbleColor, setMyBubbleColor,
      myBubbleOpacity, setMyBubbleOpacity,
      myBubbleTextColor, setMyBubbleTextColor,
      otherBubbleColor, setOtherBubbleColor,
      otherBubbleOpacity, setOtherBubbleOpacity,
      otherBubbleTextColor, setOtherBubbleTextColor,
      // tick colours
      tickColorSent, setTickColorSent,
      tickColorUnread, setTickColorUnread,
      tickColorRead, setTickColorRead,
      // reset
      resetMessagingDefaults,
      // derived styles
      myBubbleStyle, otherBubbleStyle,
      // notification preferences
      muteBatteryChanges, setMuteBatteryChanges,
      muteAllNotifications, setMuteAllNotifications,
      mutePersonalChats, setMutePersonalChats,
      muteGroupChats, setMuteGroupChats,
      // privacy
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
