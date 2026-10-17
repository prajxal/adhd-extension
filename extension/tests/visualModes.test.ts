import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VisualModes } from '@/src/modes/visualModes';
import { DEFAULT_SETTINGS, type Settings } from '@/src/shared/settings';
import { HOST_TAG } from '@/src/ui/shadowHost';

const HOST = 'example.com';

function settings(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, enabledSites: [HOST], ...patch };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rulerLayer(): Element | null {
  return document.querySelector(HOST_TAG)?.shadowRoot?.getElementById('rw-ruler') ?? null;
}

describe('VisualModes', () => {
  let modes: VisualModes;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<p>Some paragraph text here</p>';
    modes = new VisualModes(HOST, document);
  });

  afterEach(async () => {
    modes.apply(settings({ enabledSites: [] }));
    await wait(50);
  });

  it('does nothing on sites that are not turned on', async () => {
    modes.apply({ ...DEFAULT_SETTINGS, boldPrefix: { enabled: true, intensity: 0.45 }, spacing: { enabled: true } });
    await wait(50);
    expect(document.querySelector('[data-rw]')).toBeNull();
    expect(document.getElementById('rw-spacing')).toBeNull();
  });

  it('adds and removes the spacing stylesheet', () => {
    modes.apply(settings({ spacing: { enabled: true } }));
    const style = document.getElementById('rw-spacing');
    expect(style?.textContent).toContain('line-height: 1.8 !important');
    modes.apply(settings({ spacing: { enabled: false } }));
    expect(document.getElementById('rw-spacing')).toBeNull();
  });

  it('shows the ruler inside the shadow root and removes it fully', () => {
    modes.apply(settings({ ruler: { enabled: true, height: 60 } }));
    const layer = rulerLayer();
    expect(layer?.querySelectorAll('.dim').length).toBe(2);
    expect(document.body.querySelector('.dim')).toBeNull(); // nothing leaks into the page DOM

    modes.apply(settings({ ruler: { enabled: false, height: 60 } }));
    expect(rulerLayer()).toBeNull();
    expect(document.querySelector(HOST_TAG)).toBeNull();
  });

  it('turns bold-prefix on and off live, and removes the site gate cleanly', async () => {
    const before = document.body.innerHTML;
    modes.apply(settings({ boldPrefix: { enabled: true, intensity: 0.45 } }));
    await wait(50);
    expect(document.querySelector('b[data-rw="b"]')).not.toBeNull();

    // Turning the site off restores the page even though the mode is still enabled.
    modes.apply(settings({ boldPrefix: { enabled: true, intensity: 0.45 }, enabledSites: [] }));
    await wait(50);
    expect(document.body.innerHTML).toBe(before);
  });
});
