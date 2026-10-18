/**
 * Least-privilege access. The content script runs only where the user has allowed it:
 * on sites they turned on (one Chrome permission per site), or everywhere if they opted
 * in to "Simplify button on every site". Elsewhere, the right-click menu uses activeTab.
 */
import type { Settings } from './settings';

export const CONTENT_SCRIPT_ID = 'readwell-content';
export const CONTENT_SCRIPT_FILE = '/content-scripts/content.js';
export const ALL_SITES = ['http://*/*', 'https://*/*'];

/** The permission pattern for one site (both http and https). */
export function sitePattern(hostname: string): string {
  return `*://${hostname}/*`;
}

/** The hostname of a page Readwell can run on, or null (chrome:, file:, the Web Store…). */
export function webHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

export type Granted = { everywhere: boolean; hosts: ReadonlySet<string> };

/** Pure: which pages the content script should be registered for. */
export function contentScriptMatches(settings: Settings, granted: Granted): string[] {
  if (settings.simplifyEverywhere && granted.everywhere) return [...ALL_SITES];
  return settings.enabledSites.filter((host) => granted.everywhere || granted.hosts.has(host)).map(sitePattern);
}

export async function grantedAccess(settings: Settings): Promise<Granted> {
  const everywhere = await browser.permissions.contains({ origins: ALL_SITES });
  const hosts = new Set<string>();
  for (const host of settings.enabledSites) {
    if (await browser.permissions.contains({ origins: [sitePattern(host)] })) hosts.add(host);
  }
  return { everywhere, hosts };
}

/** Re-registers the content script to match settings and what Chrome has granted. */
export async function syncContentScripts(settings: Settings): Promise<string[]> {
  const matches = contentScriptMatches(settings, await grantedAccess(settings));
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (existing.length > 0) await browser.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (matches.length > 0) {
    await browser.scripting.registerContentScripts([
      // Registration takes a path relative to the extension root (no leading slash).
      { id: CONTENT_SCRIPT_ID, matches, js: [CONTENT_SCRIPT_FILE.slice(1)], runAt: 'document_idle' },
    ]);
  }
  return matches;
}

/** Injects the content script into an open tab now (it guards against running twice). */
export async function injectInto(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    return true;
  } catch {
    return false; // no access to this tab (chrome:, the Web Store, or permission refused)
  }
}
