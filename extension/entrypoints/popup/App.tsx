import { useEffect, useState, type ReactElement } from 'react';
import { readerPath } from '@/src/docs/open';
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

type TabInfo = { tabId: number; hostname: string } | null;

async function getActiveTab(): Promise<TabInfo> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  const message: ContentMessage = { type: 'get-hostname' };
  try {
    const response: unknown = await browser.tabs.sendMessage(tab.id, message);
    if (
      typeof response === 'object' &&
      response !== null &&
      'hostname' in response &&
      typeof response.hostname === 'string' &&
      response.hostname !== ''
    ) {
      return { tabId: tab.id, hostname: response.hostname };
    }
  } catch {
    // No content script on this page (e.g. chrome:// pages or the Web Store).
  }
  return null;
}

export function App(): ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<TabInfo>(null);
  const [serverUrlDraft, setServerUrlDraft] = useState('');

  useEffect(() => {
    void Promise.all([loadSettings(), getActiveTab()]).then(([s, t]) => {
      setSettings(s);
      setServerUrlDraft(s.serverUrl);
      setTab(t);
    });
  }, []);

  if (settings === null) return <main className="popup">Loading…</main>;

  const update = (next: Settings): void => {
    const clean = normalizeSettings(next);
    setSettings(clean);
    void saveSettings(clean);
    if (tab !== null) {
      const message: ContentMessage = { type: 'apply-settings', settings: clean };
      browser.tabs.sendMessage(tab.tabId, message).catch(() => {
        // Tab went away or has no content script; storage still has the change.
      });
    }
  };

  const siteOn = tab !== null && isSiteEnabled(settings, tab.hostname);

  return (
    <main className="popup">
      <h1>Readwell</h1>

      <section className="site">
        {tab === null ? (
          <p className="muted">Readwell can’t run on this page.</p>
        ) : (
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
                update(toggleSite(settings, tab.hostname, e.target.checked));
              }}
            />
          </label>
        )}
        {tab !== null && !siteOn && (
          <p className="muted small">Reading modes only apply on sites you turn on.</p>
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
              update({ ...settings, boldPrefix: { ...settings.boldPrefix, enabled: e.target.checked } });
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
              update({
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
              update({ ...settings, ruler: { ...settings.ruler, enabled: e.target.checked } });
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
              update({ ...settings, ruler: { ...settings.ruler, height: Number(e.target.value) } });
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
              update({ ...settings, spacing: { enabled: e.target.checked } });
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
                  update({ ...settings, simplifyLevel: level });
                }}
              />
              <span>{level === 1 ? '1 Light' : level === 2 ? '2 Plain' : '3 Simplest'}</span>
            </label>
          ))}
        </div>
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
            update({ ...settings, serverUrl: serverUrlDraft });
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
              update({ ...settings, serverUrl: serverUrlDraft });
            }}
          />
        </form>
      </fieldset>
    </main>
  );
}
