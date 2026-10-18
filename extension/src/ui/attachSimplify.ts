/**
 * Simplify on selection for any page we run in: the web-page content script and the
 * reader page both call this. Shows the button, the card and notices, and handles Escape.
 */
import { parseCheckResult, parseSimplifyResult, type CheckResult, type SimplifyResult } from '../shared/api';
import type { BackgroundMessage } from '../shared/messages';
import { loadSettings, updateSettings, type SimplifyLevel } from '../shared/settings';
import { mountSimplifyUi } from './mount';
import { anchorMoved, readSelection, TOO_LONG_MESSAGE, type Anchor } from './selection';
import { HOST_ATTR } from './shadowHost';
import { SimplifyFlow } from './simplifyFlow';

const NO_SELECTION_MESSAGE = 'Select some text first (at least 20 characters).';
const NOTICE_MS = 4000;

function isFromOurUi(event: Event): boolean {
  return event.composedPath().some((n) => n instanceof Element && n.hasAttribute(HOST_ATTR));
}

async function sendSimplify(text: string, level: SimplifyLevel): Promise<SimplifyResult> {
  const message: BackgroundMessage = { type: 'simplify', text, level };
  const reply: unknown = await browser.runtime.sendMessage(message);
  return parseSimplifyResult(reply) ?? { ok: false, error: 'The extension sent an unexpected reply. Try again.' };
}

async function sendCheck(text: string, level: SimplifyLevel): Promise<CheckResult> {
  const message: BackgroundMessage = { type: 'check', text, level };
  const reply: unknown = await browser.runtime.sendMessage(message);
  return parseCheckResult(reply) ?? { ok: false, reason: 'unavailable' };
}

export type SimplifyAttachment = {
  flow: SimplifyFlow;
  /** What the "Simplify selection" context-menu item does. */
  simplifyCurrentSelection: () => void;
};

export function attachSimplify(): SimplifyAttachment {
  const flow = new SimplifyFlow({
    send: sendSimplify,
    check: sendCheck,
    loadSettings,
    acceptPrivacy: async () => {
      await updateSettings((s) => ({ ...s, privacyNoticeAccepted: true }));
    },
  });
  mountSimplifyUi(flow);

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const showNotice = (message: string, anchor: Anchor): void => {
    flow.showNotice(message, anchor);
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      flow.hideTransient();
    }, NOTICE_MS);
  };

  const checkSelection = (): void => {
    // Let the browser finish updating the selection first.
    setTimeout(() => {
      const info = readSelection(window.getSelection());
      if (info === null) flow.hideTransient();
      else if (info.status === 'too-long') showNotice(TOO_LONG_MESSAGE, info.anchor);
      else flow.showButton(info.text, info.anchor);
    }, 0);
  };

  document.addEventListener('mouseup', (event) => {
    if (!isFromOurUi(event)) checkSelection();
  });
  document.addEventListener('keyup', (event) => {
    if (!isFromOurUi(event) && event.key !== 'Escape') checkSelection();
  });
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) flow.hideTransient();
  });
  // Hide on scroll, but only when the scroll actually moves the selection: carousels and
  // other inner scrollers fire scroll events constantly on some sites.
  let scrollFrame = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const state = flow.getState();
        if (state.kind !== 'button' && state.kind !== 'notice') return;
        const info = readSelection(window.getSelection());
        if (info === null || anchorMoved(info.anchor, state.anchor)) flow.hideTransient();
      });
    },
    { capture: true, passive: true },
  );

  // Escape closes the button, notice or card.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && flow.escape()) event.stopPropagation();
    },
    true,
  );

  const simplifyCurrentSelection = (): void => {
    const info = readSelection(window.getSelection());
    const center: Anchor = { x: window.innerWidth / 2, top: 80, bottom: 80 };
    if (info === null) showNotice(NO_SELECTION_MESSAGE, center);
    else if (info.status === 'too-long') showNotice(TOO_LONG_MESSAGE, info.anchor);
    else void flow.start(info.text, info.anchor);
  };

  return { flow, simplifyCurrentSelection };
}
