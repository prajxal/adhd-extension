import { attachRulerShortcut } from '@/src/modes/rulerShortcut';
import { VisualModes } from '@/src/modes/visualModes';
import { isContentMessage } from '@/src/shared/messages';
import { isSiteEnabled, loadSettings, onSettingsChanged, type Settings } from '@/src/shared/settings';
import { attachSimplify } from '@/src/ui/attachSimplify';

const LOADED = '__readwellContentScript';

export default defineContentScript({
  // Registered at runtime (see src/shared/access.ts) only for sites the user allowed,
  // or injected into one tab via activeTab. No static match patterns.
  registration: 'runtime',
  matches: [],
  runAt: 'document_idle',
  main() {
    // The popup or the context menu may inject us into a tab that already has us.
    const scope = globalThis as unknown as Record<string, boolean | undefined>;
    if (scope[LOADED]) return;
    scope[LOADED] = true;

    const hostname = window.location.hostname;
    const modes = new VisualModes(hostname);
    let current: Settings | null = null;

    const apply = (settings: Settings): void => {
      current = settings;
      modes.apply(settings);
    };

    void loadSettings().then(apply);
    onSettingsChanged(apply);

    const { simplifyCurrentSelection } = attachSimplify();
    attachRulerShortcut(() => current !== null && isSiteEnabled(current, hostname));

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
  },
});
