import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useTheme } from './ThemeContext';

const SettingsContext = createContext(null);

// ── Defaults ──────────────────────────────────────────────────────────────────
// Bubble colours optimised for each theme.
export const SETTINGS_DEFAULTS_DARK = {
  myBubbleColor:       '#00949e',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#ecfeff',
  otherBubbleColor:    '#172326',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#d8eeee',
  tickColorSent:       '#ecfeff',
  tickColorUnread:     '#b8d4d6',
  tickColorRead:       '#0f172a',
};

export const SETTINGS_DEFAULTS_LIGHT = {
  myBubbleColor:       '#c9f3f3',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#063b3f',
  otherBubbleColor:    '#ffffff',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#102a2d',
  tickColorSent:       '#4b6669',
  tickColorUnread:     '#4b6669',
  tickColorRead:       '#00949e',
};

export const SETTINGS_DEFAULTS_AURORA = {
  myBubbleColor:       '#dc5078',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#fff0f5',
  otherBubbleColor:    '#1e1836',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#f0e6ff',
  tickColorSent:       '#fff0f5',
  tickColorUnread:     '#c9a8d4',
  tickColorRead:       '#ff82a0',
};

export const SETTINGS_DEFAULTS_SUNSET = {
  myBubbleColor:       '#ea781e',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#fff3e0',
  otherBubbleColor:    '#251808',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#ffe0b2',
  tickColorSent:       '#fff3e0',
  tickColorUnread:     '#d4a870',
  tickColorRead:       '#ffb450',
};

export const SETTINGS_DEFAULTS_FOREST = {
  myBubbleColor:       '#226e36',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#f0faf2',
  otherBubbleColor:    '#ffffff',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#1a2e1a',
  tickColorSent:       '#5a7a5a',
  tickColorUnread:     '#5a7a5a',
  tickColorRead:       '#226e36',
};

export const SETTINGS_DEFAULTS_PASTEL = {
  myBubbleColor:       '#a8d4f5',
  myBubbleOpacity:     1,
  myBubbleTextColor:   '#1e2a4a',
  otherBubbleColor:    '#fdf8c8',
  otherBubbleOpacity:  1,
  otherBubbleTextColor:'#3a3010',
  tickColorSent:       '#7a90b8',
  tickColorUnread:     '#7a90b8',
  tickColorRead:       '#5096e6',
};

const LEGACY_DEFAULT_PALETTES = [
  {
    myBubbleColor:       '#1a5c3a',
    myBubbleOpacity:     1,
    myBubbleTextColor:   '#d1fae5',
    otherBubbleColor:    '#1e293b',
    otherBubbleOpacity:  1,
    otherBubbleTextColor:'#e2e8f0',
    tickColorSent:       '#ffffff',
    tickColorUnread:     '#ffffff',
    tickColorRead:       '#1d9bf0',
  },
  {
    myBubbleColor:       '#16a34a',
    myBubbleOpacity:     1,
    myBubbleTextColor:   '#ffffff',
    otherBubbleColor:    '#f1f5f9',
    otherBubbleOpacity:  1,
    otherBubbleTextColor:'#1e293b',
    tickColorSent:       '#ffffff',
    tickColorUnread:     '#ffffff',
    tickColorRead:       '#1d9bf0',
  },
];

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
  messagingUsesThemeDefaults: 'sb-messaging-uses-theme-defaults',
  // notifications
  muteBatteryChanges:    'sb-mute-battery-changes',
  muteAllNotifications:  'sb-mute-all-notifications',
  mutePersonalChats:     'sb-mute-personal-chats',
  muteGroupChats:        'sb-mute-group-chats',
  muteNewEvents:         'sb-mute-new-events',
  muteNewPools:          'sb-mute-new-pools',
  muteEventReminders:        'sb-mute-event-reminders',
  mutePoolReminders:         'sb-mute-pool-reminders',
  muteEventRecommendations:  'sb-mute-event-recommendations',
  // privacy
  readReceipts:          'sb-read-receipts',
  showOnline:            'sb-show-online',
  showLastSeen:          'sb-show-last-seen',
};

const MESSAGING_FIELDS = [
  'myBubbleColor',
  'myBubbleOpacity',
  'myBubbleTextColor',
  'otherBubbleColor',
  'otherBubbleOpacity',
  'otherBubbleTextColor',
  'tickColorSent',
  'tickColorUnread',
  'tickColorRead',
];

export function getMessagingDefaultsForTheme(theme) {
  if (theme === 'light')  return SETTINGS_DEFAULTS_LIGHT;
  if (theme === 'aurora') return SETTINGS_DEFAULTS_AURORA;
  if (theme === 'sunset') return SETTINGS_DEFAULTS_SUNSET;
  if (theme === 'forest') return SETTINGS_DEFAULTS_FOREST;
  if (theme === 'pastel') return SETTINGS_DEFAULTS_PASTEL;
  return SETTINGS_DEFAULTS_DARK;
}

function loadStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch { return fallback; }
}

function readMessagingStorageSnapshot() {
  try {
    return {
      myBubbleColor:       localStorage.getItem(STORAGE_KEYS.myBubbleColor),
      myBubbleOpacity:     localStorage.getItem(STORAGE_KEYS.myBubbleOpacity),
      myBubbleTextColor:   localStorage.getItem(STORAGE_KEYS.myBubbleTextColor),
      otherBubbleColor:    localStorage.getItem(STORAGE_KEYS.otherBubbleColor),
      otherBubbleOpacity:  localStorage.getItem(STORAGE_KEYS.otherBubbleOpacity),
      otherBubbleTextColor:localStorage.getItem(STORAGE_KEYS.otherBubbleTextColor),
      tickColorSent:       localStorage.getItem(STORAGE_KEYS.tickColorSent),
      tickColorUnread:     localStorage.getItem(STORAGE_KEYS.tickColorUnread),
      tickColorRead:       localStorage.getItem(STORAGE_KEYS.tickColorRead),
    };
  } catch {
    return {};
  }
}

function paletteValueMatches(a, b, field) {
  if (field.endsWith('Opacity')) return Math.abs(parseFloat(a) - Number(b)) < 0.001;
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function matchesPalette(snapshot, palette) {
  return MESSAGING_FIELDS.every(field => snapshot[field] != null && paletteValueMatches(snapshot[field], palette[field], field));
}

function shouldUseThemeMessagingDefaults() {
  try {
    const storedPreference = localStorage.getItem(STORAGE_KEYS.messagingUsesThemeDefaults);
    if (storedPreference !== null) return storedPreference === 'true';
  } catch {}

  const snapshot = readMessagingStorageSnapshot();
  const hasMessagingOverride = MESSAGING_FIELDS.some(field => snapshot[field] != null);
  if (!hasMessagingOverride) return true;

  return [
    SETTINGS_DEFAULTS_DARK,
    SETTINGS_DEFAULTS_LIGHT,
    SETTINGS_DEFAULTS_AURORA,
    SETTINGS_DEFAULTS_SUNSET,
    SETTINGS_DEFAULTS_FOREST,
    SETTINGS_DEFAULTS_PASTEL,
    ...LEGACY_DEFAULT_PALETTES,
  ].some(palette => matchesPalette(snapshot, palette));
}

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function SettingsProvider({ children }) {
  const { theme } = useTheme();
  const initialDefaults = getMessagingDefaultsForTheme(theme);

  // Personal chat wallpaper (shared for all personal chats)
  const [chatWallpaper, setChatWallpaperState] = useState(
    () => loadStorage(STORAGE_KEYS.chatWallpaper, null)
  );
  const [usesThemeMessagingDefaults, setUsesThemeMessagingDefaults] = useState(
    () => shouldUseThemeMessagingDefaults()
  );

  // My bubble
  const [myBubbleColor, setMyBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.myBubbleColor, initialDefaults.myBubbleColor)
  );
  const [myBubbleOpacity, setMyBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.myBubbleOpacity, String(initialDefaults.myBubbleOpacity)))
  );
  const [myBubbleTextColor, setMyBubbleTextColorState] = useState(
    () => loadStorage(STORAGE_KEYS.myBubbleTextColor, initialDefaults.myBubbleTextColor)
  );

  // Other people's bubble
  const [otherBubbleColor, setOtherBubbleColorState] = useState(
    () => loadStorage(STORAGE_KEYS.otherBubbleColor, initialDefaults.otherBubbleColor)
  );
  const [otherBubbleOpacity, setOtherBubbleOpacityState] = useState(
    () => parseFloat(loadStorage(STORAGE_KEYS.otherBubbleOpacity, String(initialDefaults.otherBubbleOpacity)))
  );
  const [otherBubbleTextColor, setOtherBubbleTextColorState] = useState(
    () => loadStorage(STORAGE_KEYS.otherBubbleTextColor, initialDefaults.otherBubbleTextColor)
  );

  // Tick colours
  const [tickColorSent, setTickColorSentState] = useState(() => {
    const stored = loadStorage(STORAGE_KEYS.tickColorSent, initialDefaults.tickColorSent);
    // Migrate old grey defaults (#475569 / #64748b) to current themed default
    if (stored === '#475569' || stored === '#64748b') return initialDefaults.tickColorSent;
    return stored;
  });
  const [tickColorUnread, setTickColorUnreadState] = useState(() => {
    const stored = loadStorage(STORAGE_KEYS.tickColorUnread, initialDefaults.tickColorUnread);
    // Migrate old grey defaults (#475569 / #64748b) to current themed default
    if (stored === '#475569' || stored === '#64748b') return initialDefaults.tickColorUnread;
    return stored;
  });
  const [tickColorRead, setTickColorReadState] = useState(
    () => loadStorage(STORAGE_KEYS.tickColorRead, initialDefaults.tickColorRead)
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
  const [muteNewEvents, setMuteNewEventsState] = useState(
    () => loadStorage(STORAGE_KEYS.muteNewEvents, 'false') === 'true'
  );
  const [muteNewPools, setMuteNewPoolsState] = useState(
    () => loadStorage(STORAGE_KEYS.muteNewPools, 'false') === 'true'
  );
  const [muteEventReminders, setMuteEventRemindersState] = useState(
    () => loadStorage(STORAGE_KEYS.muteEventReminders, 'false') === 'true'
  );
  const [mutePoolReminders, setMutePoolRemindersState] = useState(
    () => loadStorage(STORAGE_KEYS.mutePoolReminders, 'false') === 'true'
  );
  const [muteEventRecommendations, setMuteEventRecommendationsState] = useState(
    () => loadStorage(STORAGE_KEYS.muteEventRecommendations, 'false') === 'true'
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

  const markMessagingCustomized = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEYS.messagingUsesThemeDefaults, 'false'); } catch {}
    setUsesThemeMessagingDefaults(false);
  }, []);

  const setMyBubbleColor = useCallback((hex) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.myBubbleColor, hex);
    setMyBubbleColorState(hex);
  }, [markMessagingCustomized]);

  const setMyBubbleOpacity = useCallback((v) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.myBubbleOpacity, String(v));
    setMyBubbleOpacityState(v);
  }, [markMessagingCustomized]);

  const setMyBubbleTextColor = useCallback((hex) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.myBubbleTextColor, hex);
    setMyBubbleTextColorState(hex);
  }, [markMessagingCustomized]);

  const setOtherBubbleColor = useCallback((hex) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.otherBubbleColor, hex);
    setOtherBubbleColorState(hex);
  }, [markMessagingCustomized]);

  const setOtherBubbleOpacity = useCallback((v) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.otherBubbleOpacity, String(v));
    setOtherBubbleOpacityState(v);
  }, [markMessagingCustomized]);

  const setOtherBubbleTextColor = useCallback((hex) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.otherBubbleTextColor, hex);
    setOtherBubbleTextColorState(hex);
  }, [markMessagingCustomized]);

  const setTickColorSent = useCallback((hex) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.tickColorSent, hex);
    setTickColorSentState(hex);
  }, [markMessagingCustomized]);

  const setTickColorUnread = useCallback((hex) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.tickColorUnread, hex);
    setTickColorUnreadState(hex);
  }, [markMessagingCustomized]);

  const setTickColorRead = useCallback((hex) => {
    markMessagingCustomized();
    localStorage.setItem(STORAGE_KEYS.tickColorRead, hex);
    setTickColorReadState(hex);
  }, [markMessagingCustomized]);

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

  const setMuteNewEvents = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.muteNewEvents, String(v));
    setMuteNewEventsState(v);
  }, []);

  const setMuteNewPools = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.muteNewPools, String(v));
    setMuteNewPoolsState(v);
  }, []);

  const setMuteEventReminders = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.muteEventReminders, String(v));
    setMuteEventRemindersState(v);
  }, []);

  const setMutePoolReminders = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.mutePoolReminders, String(v));
    setMutePoolRemindersState(v);
  }, []);

  const setMuteEventRecommendations = useCallback((v) => {
    localStorage.setItem(STORAGE_KEYS.muteEventRecommendations, String(v));
    setMuteEventRecommendationsState(v);
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

  const applyMessagingThemeDefaults = useCallback((themeName = theme) => {
    const d = getMessagingDefaultsForTheme(themeName);
    localStorage.setItem(STORAGE_KEYS.myBubbleColor,        d.myBubbleColor);
    localStorage.setItem(STORAGE_KEYS.myBubbleOpacity,      String(d.myBubbleOpacity));
    localStorage.setItem(STORAGE_KEYS.myBubbleTextColor,    d.myBubbleTextColor);
    localStorage.setItem(STORAGE_KEYS.otherBubbleColor,     d.otherBubbleColor);
    localStorage.setItem(STORAGE_KEYS.otherBubbleOpacity,   String(d.otherBubbleOpacity));
    localStorage.setItem(STORAGE_KEYS.otherBubbleTextColor, d.otherBubbleTextColor);
    localStorage.setItem(STORAGE_KEYS.tickColorSent,        d.tickColorSent);
    localStorage.setItem(STORAGE_KEYS.tickColorUnread,      d.tickColorUnread);
    localStorage.setItem(STORAGE_KEYS.tickColorRead,        d.tickColorRead);
    localStorage.setItem(STORAGE_KEYS.messagingUsesThemeDefaults, 'true');
    setMyBubbleColorState(d.myBubbleColor);
    setMyBubbleOpacityState(d.myBubbleOpacity);
    setMyBubbleTextColorState(d.myBubbleTextColor);
    setOtherBubbleColorState(d.otherBubbleColor);
    setOtherBubbleOpacityState(d.otherBubbleOpacity);
    setOtherBubbleTextColorState(d.otherBubbleTextColor);
    setTickColorSentState(d.tickColorSent);
    setTickColorUnreadState(d.tickColorUnread);
    setTickColorReadState(d.tickColorRead);
    setUsesThemeMessagingDefaults(true);
  }, [theme]);

  const resetMessagingDefaults = useCallback((themeName = theme) => {
    applyMessagingThemeDefaults(themeName);
  }, [applyMessagingThemeDefaults, theme]);

  useEffect(() => {
    if (usesThemeMessagingDefaults) {
      applyMessagingThemeDefaults(theme);
    }
  }, [theme, usesThemeMessagingDefaults, applyMessagingThemeDefaults]);

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
      applyMessagingThemeDefaults, resetMessagingDefaults,
      // derived styles
      myBubbleStyle, otherBubbleStyle,
      // notification preferences
      muteBatteryChanges, setMuteBatteryChanges,
      muteAllNotifications, setMuteAllNotifications,
      mutePersonalChats, setMutePersonalChats,
      muteGroupChats, setMuteGroupChats,
      muteNewEvents, setMuteNewEvents,
      muteNewPools, setMuteNewPools,
      muteEventReminders, setMuteEventReminders,
      mutePoolReminders, setMutePoolReminders,
      muteEventRecommendations, setMuteEventRecommendations,
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
