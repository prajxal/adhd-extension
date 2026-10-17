import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  isSiteEnabled,
  loadSettings,
  normalizeSettings,
  saveSettings,
  toggleSite,
  updateSettings,
} from '@/src/shared/settings';

describe('normalizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps intensity and ruler height into range', () => {
    const s = normalizeSettings({ boldPrefix: { enabled: true, intensity: 2 }, ruler: { height: 1 } });
    expect(s.boldPrefix).toEqual({ enabled: true, intensity: 0.6 });
    expect(s.ruler.height).toBe(24);
  });

  it('rejects invalid simplify levels', () => {
    expect(normalizeSettings({ simplifyLevel: 7 }).simplifyLevel).toBe(2);
    expect(normalizeSettings({ simplifyLevel: 3 }).simplifyLevel).toBe(3);
  });

  it('trims trailing slashes from the server URL and dedupes sites', () => {
    const s = normalizeSettings({ serverUrl: 'http://x.test:8000/ ', enabledSites: ['a.com', 'a.com', 3] });
    expect(s.serverUrl).toBe('http://x.test:8000');
    expect(s.enabledSites).toEqual(['a.com']);
  });
});

describe('site toggling', () => {
  it('adds and removes a hostname', () => {
    const on = toggleSite(DEFAULT_SETTINGS, 'en.wikipedia.org', true);
    expect(isSiteEnabled(on, 'en.wikipedia.org')).toBe(true);
    const off = toggleSite(on, 'en.wikipedia.org', false);
    expect(isSiteEnabled(off, 'en.wikipedia.org')).toBe(false);
  });
});

describe('storage round-trip', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('loads defaults when storage is empty', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and reloads settings', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, simplifyLevel: 3, spacing: { enabled: true } });
    const loaded = await loadSettings();
    expect(loaded.simplifyLevel).toBe(3);
    expect(loaded.spacing.enabled).toBe(true);
  });

  it('updateSettings applies a change on top of stored values', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, simplifyLevel: 1 });
    const next = await updateSettings((s) => ({ ...s, ruler: { ...s.ruler, enabled: true } }));
    expect(next.simplifyLevel).toBe(1);
    expect(next.ruler.enabled).toBe(true);
  });
});
