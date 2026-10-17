import { isContentMessage } from '@/src/shared/messages';
import { loadSettings, onSettingsChanged, type Settings } from '@/src/shared/settings';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let current: Settings | null = null;

    const apply = (settings: Settings): void => {
      current = settings;
      // Visual modes are wired in milestone 2.
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
          sendResponse({ hostname: window.location.hostname, active: current !== null });
          return;
      }
    });
  },
});
