import { describe, expect, it } from 'vitest';
import type { CheckResult, SimplifyResult } from '@/src/shared/api';
import { DEFAULT_SETTINGS, type Settings, type SimplifyLevel } from '@/src/shared/settings';
import { SimplifyFlow, type UiState } from '@/src/ui/simplifyFlow';
import { CHECK_FLAGGED, CHECK_OK, SAMPLE } from './fixtures';

const ANCHOR = { x: 10, top: 10, bottom: 30 };

type Pending = { text: string; level: SimplifyLevel; resolve: (r: SimplifyResult) => void };

type PendingCheck = { text: string; level: SimplifyLevel; resolve: (r: CheckResult) => void };

/** `holdChecks`: keep /check replies pending so a test can control their timing. */
function setup(privacyAccepted = true, holdChecks = false) {
  let settings: Settings = { ...DEFAULT_SETTINGS, privacyNoticeAccepted: privacyAccepted, simplifyLevel: 2 };
  const pending: Pending[] = [];
  const checks: PendingCheck[] = [];
  const flow = new SimplifyFlow({
    send: (text, level) => new Promise((resolve) => pending.push({ text, level, resolve })),
    check: (text, level) =>
      holdChecks
        ? new Promise((resolve) => checks.push({ text, level, resolve }))
        : Promise.resolve({ ok: true, data: CHECK_OK }),
    loadSettings: () => Promise.resolve(settings),
    acceptPrivacy: () => {
      settings = { ...settings, privacyNoticeAccepted: true };
      return Promise.resolve();
    },
    now: () => 0,
  });
  return { flow, pending, checks, getSettings: () => settings };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const kind = (s: UiState): string => (s.kind === 'card' ? `card:${s.request.status}` : s.kind);

describe('SimplifyFlow', () => {
  it('shows the privacy notice before the first request', async () => {
    const { flow, pending, getSettings } = setup(false);
    await flow.start('some long text', ANCHOR);
    expect(flow.getState().kind).toBe('privacy');
    expect(pending).toHaveLength(0); // nothing sent before consent

    const accepted = flow.acceptPrivacy();
    await flush();
    expect(getSettings().privacyNoticeAccepted).toBe(true);
    expect(kind(flow.getState())).toBe('card:loading');
    pending[0]?.resolve({ ok: true, data: SAMPLE });
    await accepted;
    expect(kind(flow.getState())).toBe('card:done');
  });

  it('sends nothing when the privacy notice is cancelled', async () => {
    const { flow, pending } = setup(false);
    await flow.start('text', ANCHOR);
    flow.close();
    expect(flow.getState().kind).toBe('hidden');
    expect(pending).toHaveLength(0);
  });

  it('goes loading → error → retry → done', async () => {
    const { flow, pending } = setup();
    const first = flow.start('text', ANCHOR);
    await flush();
    pending[0]?.resolve({ ok: false, error: 'Server not reachable at http://localhost:8000' });
    await first;
    const state = flow.getState();
    expect(state.kind === 'card' && state.request.status === 'error' ? state.request.message : '').toContain('not reachable');

    const retry = flow.retry();
    expect(kind(flow.getState())).toBe('card:loading');
    pending[1]?.resolve({ ok: true, data: SAMPLE });
    await retry;
    expect(kind(flow.getState())).toBe('card:done');
    expect(pending[1]?.text).toBe('text');
  });

  it('re-requests at a new level and ignores stale replies', async () => {
    const { flow, pending } = setup();
    void flow.start('text', ANCHOR);
    await flush();
    const switched = flow.changeLevel(3);
    expect(pending.map((p) => p.level)).toEqual([2, 3]);

    pending[1]?.resolve({ ok: true, data: { ...SAMPLE, tldr: 'level 3' } });
    await switched;
    pending[0]?.resolve({ ok: true, data: { ...SAMPLE, tldr: 'stale level 2' } });
    await flush();

    const state = flow.getState();
    expect(state.kind === 'card' ? state.level : 0).toBe(3);
    expect(state.kind === 'card' && state.request.status === 'done' ? state.request.data.tldr : '').toBe('level 3');
  });

  it('drops a reply that arrives after the card was closed', async () => {
    const { flow, pending } = setup();
    void flow.start('text', ANCHOR);
    await flush();
    flow.close();
    pending[0]?.resolve({ ok: true, data: SAMPLE });
    await flush();
    expect(flow.getState().kind).toBe('hidden');
  });

  it('never lets a new selection replace an open card', async () => {
    const { flow } = setup();
    void flow.start('text', ANCHOR);
    await flush();
    flow.showButton('other text', ANCHOR);
    flow.hideTransient();
    expect(kind(flow.getState())).toBe('card:loading');
  });

  it('escape closes the button and the card', () => {
    const { flow } = setup();
    flow.showButton('text', ANCHOR);
    expect(flow.escape()).toBe(true);
    expect(flow.getState().kind).toBe('hidden');
    expect(flow.escape()).toBe(false);
  });
});

const checkOf = (s: UiState): string => (s.kind === 'card' ? s.check.status : 'none');

describe('SimplifyFlow meaning check', () => {
  it('runs the check for the same text and level once the result arrives', async () => {
    const { flow, pending, checks } = setup(true, true);
    void flow.start('passage', ANCHOR);
    await flush();
    expect(checkOf(flow.getState())).toBe('idle'); // nothing checked before the result
    pending[0]?.resolve({ ok: true, data: SAMPLE });
    await flush();
    expect(checkOf(flow.getState())).toBe('loading');
    expect(checks.map((c) => [c.text, c.level])).toEqual([['passage', 2]]);
    checks[0]?.resolve({ ok: true, data: CHECK_FLAGGED });
    await flush();
    const state = flow.getState();
    expect(state.kind === 'card' && state.check.status === 'done' ? state.check.data.summary.problem : -1).toBe(1);
    expect(kind(state)).toBe('card:done'); // the result itself is untouched
  });

  it('does not check when simplifying failed', async () => {
    const { flow, pending, checks } = setup(true, true);
    void flow.start('passage', ANCHOR);
    await flush();
    pending[0]?.resolve({ ok: false, error: 'Server not reachable at http://localhost:8000' });
    await flush();
    expect(checks).toHaveLength(0);
    expect(checkOf(flow.getState())).toBe('idle');
  });

  const UNAVAILABLE: CheckResult = { ok: false, reason: 'unavailable' };
  const OFF: CheckResult = { ok: false, reason: 'off' };

  it.each([
    [UNAVAILABLE, 'unavailable'],
    [OFF, 'off'],
  ])('maps a failed check to %o', async (reply, status) => {
    const { flow, pending, checks } = setup(true, true);
    void flow.start('passage', ANCHOR);
    await flush();
    pending[0]?.resolve({ ok: true, data: SAMPLE });
    await flush();
    checks[0]?.resolve(reply);
    await flush();
    expect(checkOf(flow.getState())).toBe(status);
  });

  it('ignores a check reply for a level the reader has left', async () => {
    const { flow, pending, checks } = setup(true, true);
    void flow.start('passage', ANCHOR);
    await flush();
    pending[0]?.resolve({ ok: true, data: SAMPLE });
    await flush();
    void flow.changeLevel(3); // new request; the level-2 check is now stale
    checks[0]?.resolve({ ok: true, data: CHECK_FLAGGED });
    await flush();
    expect(checkOf(flow.getState())).toBe('idle');
    pending[1]?.resolve({ ok: true, data: SAMPLE });
    await flush();
    expect(checks.map((c) => c.level)).toEqual([2, 3]);
  });

  it('ignores a check reply after the card was closed', async () => {
    const { flow, pending, checks } = setup(true, true);
    void flow.start('passage', ANCHOR);
    await flush();
    pending[0]?.resolve({ ok: true, data: SAMPLE });
    await flush();
    flow.close();
    checks[0]?.resolve({ ok: true, data: CHECK_FLAGGED });
    await flush();
    expect(flow.getState().kind).toBe('hidden');
  });
});
