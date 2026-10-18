import { browser } from 'wxt/browser';

export type SimplifyLevel = 1 | 2 | 3;

export type Settings = {
  boldPrefix: { enabled: boolean; intensity: number }; // 0.3–0.6
  ruler: { enabled: boolean; height: number }; // px
  spacing: { enabled: boolean };
  simplifyLevel: SimplifyLevel;
  serverUrl: string;
  enabledSites: string[]; // hostnames where visual modes auto-apply
  privacyNoticeAccepted: boolean;
  /** Opt-in: show the Simplify button on every site (needs Chrome's all-sites permission). */
  simplifyEverywhere: boolean;
};

export const SETTINGS_KEY = 'settings';

export const INTENSITY_MIN = 0.3;
export const INTENSITY_MAX = 0.6;
export const RULER_HEIGHT_MIN = 24;
export const RULER_HEIGHT_MAX = 160;

export const DEFAULT_SETTINGS: Settings = {
  boldPrefix: { enabled: false, intensity: 0.45 },
  ruler: { enabled: false, height: 48 },
  spacing: { enabled: false },
  simplifyLevel: 2,
  serverUrl: 'http://localhost:8000',
  enabledSites: [],
  privacyNoticeAccepted: false,
  simplifyEverywhere: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readLevel(value: unknown): SimplifyLevel {
  return value === 1 || value === 2 || value === 3 ? value : DEFAULT_SETTINGS.simplifyLevel;
}

/** Turns whatever is in storage into a valid Settings object, filling gaps with defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const src = isRecord(raw) ? raw : {};
  const bp = isRecord(src.boldPrefix) ? src.boldPrefix : {};
  const ruler = isRecord(src.ruler) ? src.ruler : {};
  const spacing = isRecord(src.spacing) ? src.spacing : {};
  const d = DEFAULT_SETTINGS;

  return {
    boldPrefix: {
      enabled: readBoolean(bp.enabled, d.boldPrefix.enabled),
      intensity: readNumber(bp.intensity, d.boldPrefix.intensity, INTENSITY_MIN, INTENSITY_MAX),
    },
    ruler: {
      enabled: readBoolean(ruler.enabled, d.ruler.enabled),
      height: readNumber(ruler.height, d.ruler.height, RULER_HEIGHT_MIN, RULER_HEIGHT_MAX),
    },
    spacing: { enabled: readBoolean(spacing.enabled, d.spacing.enabled) },
    simplifyLevel: readLevel(src.simplifyLevel),
    serverUrl:
      typeof src.serverUrl === 'string' && src.serverUrl.trim() !== ''
        ? src.serverUrl.trim().replace(/\/+$/, '')
        : d.serverUrl,
    enabledSites: Array.isArray(src.enabledSites)
      ? [...new Set(src.enabledSites.filter((s): s is string => typeof s === 'string' && s !== ''))]
      : [],
    privacyNoticeAccepted: readBoolean(src.privacyNoticeAccepted, d.privacyNoticeAccepted),
    simplifyEverywhere: readBoolean(src.simplifyEverywhere, d.simplifyEverywhere),
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.sync.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

/** Reads, applies `update`, writes back. Returns the saved settings. */
export async function updateSettings(update: (current: Settings) => Settings): Promise<Settings> {
  const next = normalizeSettings(update(await loadSettings()));
  await browser.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void => {
    const change = changes[SETTINGS_KEY];
    if (areaName === 'sync' && change !== undefined) {
      callback(normalizeSettings(change.newValue));
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}

export function isSiteEnabled(settings: Settings, hostname: string): boolean {
  return settings.enabledSites.includes(hostname);
}

export function toggleSite(settings: Settings, hostname: string, on: boolean): Settings {
  const sites = settings.enabledSites.filter((h) => h !== hostname);
  return { ...settings, enabledSites: on ? [...sites, hostname] : sites };
}
