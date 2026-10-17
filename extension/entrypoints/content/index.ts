import { VisualModes } from '@/src/modes/visualModes';
import { isContentMessage } from '@/src/shared/messages';
import {
  isSiteEnabled,
  loadSettings,
  onSettingsChanged,
  updateSettings,
  type Settings,
} from '@/src/shared/settings';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
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
      }
    });

    // Alt+R toggles the ruler. Uses `code` so it works on macOS, where Alt+R types "®".
    window.addEventListener(
      'keydown',
      (event) => {
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
