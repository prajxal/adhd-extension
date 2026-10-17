import type { CheckResult, SimplifyResult } from '@/src/shared/api';
import { isBackgroundMessage, type BackgroundMessage, type ContentMessage } from '@/src/shared/messages';
import { loadSettings } from '@/src/shared/settings';
import { requestCheck, requestSimplify } from '@/src/shared/simplifyClient';

const MENU_ID = 'rw-simplify-selection';

async function handle(message: BackgroundMessage): Promise<SimplifyResult | CheckResult> {
  const { serverUrl } = await loadSettings();
  return message.type === 'simplify'
    ? requestSimplify(serverUrl, message.text, message.level)
    : requestCheck(serverUrl, message.text, message.level);
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_ID,
        title: 'Simplify selection',
        contexts: ['selection'],
      });
    });
  });

  // The content script reads the live selection itself, so the menu and button share one path.
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
    const message: ContentMessage = { type: 'simplify-selection' };
    browser.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => {
      // No content script on this page (e.g. chrome:// or the Web Store).
    });
  });

  // The only network call to the server. The extension never talks to an LLM directly.
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isBackgroundMessage(message)) return;
    void handle(message).then(sendResponse);
    return true; // keep the channel open for the async reply
  });
});
