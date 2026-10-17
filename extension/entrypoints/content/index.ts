import { VisualModes } from '@/src/modes/visualModes';
import {
  parseCheckResult,
  parseSimplifyResult,
  type CheckResult,
  type SimplifyResult,
} from '@/src/shared/api';
import { isContentMessage, type BackgroundMessage } from '@/src/shared/messages';
import {
  isSiteEnabled,
  loadSettings,
  onSettingsChanged,
  updateSettings,
  type Settings,
  type SimplifyLevel,
} from '@/src/shared/settings';
import { mountSimplifyUi } from '@/src/ui/mount';
import { anchorMoved, readSelection, TOO_LONG_MESSAGE, type Anchor } from '@/src/ui/selection';
import { HOST_ATTR } from '@/src/ui/shadowHost';
import { SimplifyFlow } from '@/src/ui/simplifyFlow';

const NO_SELECTION_MESSAGE = 'Select some text first (at least 20 characters).';
const NOTICE_MS = 4000;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

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

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const hostname = window.location.hostname;
    const modes = new VisualModes(hostname);
    let current: Settings | null = null;

    const apply = (settings: Settings): void => {
      current = settings;
      modes.apply(settings);
    };

    void loadSettings().then(apply);
    onSettingsChanged(apply);

    // ---- Simplify on selection ----
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

    const simplifyCurrentSelection = (): void => {
      const info = readSelection(window.getSelection());
      const center: Anchor = { x: window.innerWidth / 2, top: 80, bottom: 80 };
      if (info === null) showNotice(NO_SELECTION_MESSAGE, center);
      else if (info.status === 'too-long') showNotice(TOO_LONG_MESSAGE, info.anchor);
      else void flow.start(info.text, info.anchor);
    };

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isContentMessage(message)) return;
      switch (message.type) {
        case 'apply-settings':
          apply(message.settings);
          sendResponse({ ok: true });
          return;
        case 'get-hostname':
          sendResponse({ hostname, active: current !== null });
          return;
        case 'simplify-selection':
          simplifyCurrentSelection();
          sendResponse({ ok: true });
          return;
      }
    });

    window.addEventListener(
      'keydown',
      (event) => {
        // Escape closes the button, notice or card.
        if (event.key === 'Escape') {
          if (flow.escape()) event.stopPropagation();
          return;
        }
        // Alt+R toggles the ruler. Uses `code` so it works on macOS, where Alt+R types "®".
        if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyR') return;
        if (isEditableTarget(event.target)) return; // let people type in fields
        if (current === null || !isSiteEnabled(current, hostname)) return;
        event.preventDefault();
        void updateSettings((s) => ({ ...s, ruler: { ...s.ruler, enabled: !s.ruler.enabled } }));
      },
      true,
    );
  },
});
