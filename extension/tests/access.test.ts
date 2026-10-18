import { describe, expect, it } from 'vitest';
import { ALL_SITES, contentScriptMatches, sitePattern, webHostname } from '@/src/shared/access';
import { DEFAULT_SETTINGS, normalizeSettings } from '@/src/shared/settings';

const settings = (patch: Partial<typeof DEFAULT_SETTINGS>): typeof DEFAULT_SETTINGS => ({ ...DEFAULT_SETTINGS, ...patch });
const none = { everywhere: false, hosts: new Set<string>() };

describe('contentScriptMatches', () => {
  it('runs nowhere by default', () => {
    expect(contentScriptMatches(DEFAULT_SETTINGS, none)).toEqual([]);
  });

  it('runs only on turned-on sites that Chrome has granted', () => {
    const s = settings({ enabledSites: ['en.wikipedia.org', 'news.example'] });
    expect(contentScriptMatches(s, { everywhere: false, hosts: new Set(['en.wikipedia.org']) })).toEqual([
      '*://en.wikipedia.org/*',
    ]);
  });

  it('runs everywhere only when opted in and granted', () => {
    expect(contentScriptMatches(settings({ simplifyEverywhere: true }), none)).toEqual([]);
    expect(contentScriptMatches(settings({ simplifyEverywhere: true }), { everywhere: true, hosts: new Set() })).toEqual(ALL_SITES);
  });

  it('an all-sites grant still only runs on turned-on sites without the opt-in', () => {
    const s = settings({ enabledSites: ['a.test'] });
    expect(contentScriptMatches(s, { everywhere: true, hosts: new Set() })).toEqual(['*://a.test/*']);
  });
});

describe('helpers', () => {
  it('builds one-site patterns and reads web hostnames only', () => {
    expect(sitePattern('en.wikipedia.org')).toBe('*://en.wikipedia.org/*');
    expect(webHostname('https://en.wikipedia.org/wiki/X')).toBe('en.wikipedia.org');
    expect(webHostname('chrome://extensions')).toBeNull();
    expect(webHostname('file:///a.pdf')).toBeNull();
    expect(webHostname(undefined)).toBeNull();
  });

  it('simplifyEverywhere defaults to off and survives a round trip', () => {
    expect(DEFAULT_SETTINGS.simplifyEverywhere).toBe(false);
    expect(normalizeSettings({ simplifyEverywhere: true }).simplifyEverywhere).toBe(true);
    expect(normalizeSettings({ simplifyEverywhere: 'yes' }).simplifyEverywhere).toBe(false);
  });
});
