import { useEffect, useState, type ReactElement } from 'react';
import { readerPath } from '@/src/docs/open';
import { ALL_SITES, injectInto, sitePattern, webHostname } from '@/src/shared/access';
import type { ContentMessage } from '@/src/shared/messages';
import {
  INTENSITY_MAX,
  INTENSITY_MIN,
  RULER_HEIGHT_MAX,
  RULER_HEIGHT_MIN,
  isSiteEnabled,
  loadSettings,
  normalizeSettings,
  saveSettings,
  toggleSite,
  type Settings,
  type SimplifyLevel,
} from '@/src/shared/settings';

type TabInfo =
  | { kind: 'site'; tabId: number; hostname: string }
  | { kind: 'reader' }
  | { kind: 'none' };

/** Opening the popup grants activeTab, so the current tab's address is readable. */
async function getActiveTab(): Promise<TabInfo> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return { kind: 'none' };
  if (tab.url?.startsWith(browser.runtime.getURL(readerPath()))) return { kind: 'reader' };
  const hostname = webHostname(tab.url);
  return hostname ? { kind: 'site', tabId: tab.id, hostname } : { kind: 'none' };
}

export function App(): ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<TabInfo>({ kind: 'none' });
  const [serverUrlDraft, setServerUrlDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([loadSettings(), getActiveTab()]).then(([s, t]) => {
      setSettings(s);
      setServerUrlDraft(s.serverUrl);
      setTab(t);
    });
  }, []);

  if (settings === null) return <main className="popup">Loading…</main>;

  const update = async (next: Settings): Promise<void> => {
    const clean = normalizeSettings(next);
    setSettings(clean);
    await saveSettings(clean);
    if (tab.kind === 'site') {
      const message: ContentMessage = { type: 'apply-settings', settings: clean };
      browser.tabs.sendMessage(tab.tabId, message).catch(() => {
        // No content script in this tab; storage still has the change.
      });
    }
  };

  const siteOn = tab.kind === 'site' && isSiteEnabled(settings, tab.hostname);

  /** Turning a site on asks Chrome for that one site; turning it off gives the access back. */
  const setSite = async (hostname: string, tabId: number, on: boolean): Promise<void> => {
    setNotice(null);
    if (on) {
      // First await in the click handler: Chrome only prompts during a user gesture.
      const granted = await browser.permissions.request({ origins: [sitePattern(hostname)] });
      if (!granted) {
        setNotice('Chrome didn’t allow Readwell on this site, so reading modes stay off.');
        return;
      }
      await update(toggleSite(settings, hostname, true));
      await injectInto(tabId); // apply now, without reloading the page
    } else {
      await update(toggleSite(settings, hostname, false));
      await browser.permissions.remove({ origins: [sitePattern(hostname)] }).catch(() => false);
    }
  };

  const setEverywhere = async (on: boolean): Promise<void> => {
    setNotice(null);
    if (on) {
      const granted = await browser.permissions.request({ origins: ALL_SITES });
      if (!granted) {
        setNotice('Chrome didn’t allow access to all sites. Right-click → Simplify selection still works.');
        return;
      }
      await update({ ...settings, simplifyEverywhere: true });
      if (tab.kind === 'site') await injectInto(tab.tabId);
    } else {
      await update({ ...settings, simplifyEverywhere: false });
      await browser.permissions.remove({ origins: ALL_SITES }).catch(() => false);
    }
  };

  return (
    <main className="popup">
      <h1>Readwell</h1>

      <section className="site">
        {tab.kind === 'none' && <p className="muted">Readwell can’t run on this page.</p>}
        {tab.kind === 'reader' && <p className="muted">Reading modes apply in the reader automatically.</p>}
        {tab.kind === 'site' && (
          <label className="row">
            <span>
              Turn on for this site
              <span className="muted block">{tab.hostname}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={siteOn}
              onChange={(e) => {
                void setSite(tab.hostname, tab.tabId, e.target.checked);
              }}
            />
          </label>
        )}
        {tab.kind === 'site' && !siteOn && (
          <p className="muted small">Reading modes only apply on sites you turn on. Chrome asks once per site.</p>
        )}
        {notice && (
          <p className="notice small" role="status">
            {notice}
          </p>
        )}
      </section>

      <fieldset>
        <legend>Reading modes</legend>

        <label className="row">
          <span>Bold-prefix</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.boldPrefix.enabled}
            onChange={(e) => {
              void update({ ...settings, boldPrefix: { ...settings.boldPrefix, enabled: e.target.checked } });
            }}
          />
        </label>
        <label className="slider">
          <span>
            Bold amount <output>{Math.round(settings.boldPrefix.intensity * 100)}%</output>
          </span>
          <input
            type="range"
            min={INTENSITY_MIN}
            max={INTENSITY_MAX}
            step={0.05}
            value={settings.boldPrefix.intensity}
            onChange={(e) => {
              void update({
                ...settings,
                boldPrefix: { ...settings.boldPrefix, intensity: Number(e.target.value) },
              });
            }}
          />
        </label>

        <label className="row">
          <span>
            Reading ruler <span className="muted">(Alt+R)</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.ruler.enabled}
            onChange={(e) => {
              void update({ ...settings, ruler: { ...settings.ruler, enabled: e.target.checked } });
            }}
          />
        </label>
        <label className="slider">
          <span>
            Ruler height <output>{settings.ruler.height}px</output>
          </span>
          <input
            type="range"
            min={RULER_HEIGHT_MIN}
            max={RULER_HEIGHT_MAX}
            step={4}
            value={settings.ruler.height}
            onChange={(e) => {
              void update({ ...settings, ruler: { ...settings.ruler, height: Number(e.target.value) } });
            }}
          />
        </label>

        <label className="row">
          <span>Extra spacing</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.spacing.enabled}
            onChange={(e) => {
              void update({ ...settings, spacing: { enabled: e.target.checked } });
            }}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Simplify level</legend>
        <div className="levels" role="radiogroup" aria-label="Simplify level">
          {([1, 2, 3] as const).map((level: SimplifyLevel) => (
            <label key={level} className="level">
              <input
                type="radio"
                name="level"
                checked={settings.simplifyLevel === level}
                onChange={() => {
                  void update({ ...settings, simplifyLevel: level });
                }}
              />
              <span>{level === 1 ? '1 Light' : level === 2 ? '2 Plain' : '3 Simplest'}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Simplify</legend>
        <label className="row">
          <span>
            Simplify button on every site
            <span className="muted block">Off: right-click → Simplify selection works anywhere.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.simplifyEverywhere}
            onChange={(e) => {
              void setEverywhere(e.target.checked);
            }}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Documents</legend>
        <button
          type="button"
          className="open-file"
          onClick={() => {
            void browser.tabs.create({ url: browser.runtime.getURL(readerPath()) });
          }}
        >
          Open a PDF or PowerPoint file…
        </button>
      </fieldset>

      <fieldset>
        <legend>Server</legend>
        <form
          className="server"
          onSubmit={(e) => {
            e.preventDefault();
            void update({ ...settings, serverUrl: serverUrlDraft });
          }}
        >
          <input
            type="url"
            aria-label="Server URL"
            value={serverUrlDraft}
            onChange={(e) => {
              setServerUrlDraft(e.target.value);
            }}
            onBlur={() => {
              void update({ ...settings, serverUrl: serverUrlDraft });
            }}
          />
        </form>
      </fieldset>
    </main>
  );
}
