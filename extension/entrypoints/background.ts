import type { CheckResult, SimplifyResult } from '@/src/shared/api';
import { isOpenableUrl, readerPath } from '@/src/docs/open';
import { isBackgroundMessage, type BackgroundMessage, type ContentMessage } from '@/src/shared/messages';
import { loadSettings } from '@/src/shared/settings';
import { requestCheck, requestSimplify } from '@/src/shared/simplifyClient';

const MENU_ID = 'rw-simplify-selection';
const OPEN_LINK_ID = 'rw-open-link';
// Links to documents Readwell can open (match patterns are case-sensitive).
const DOCUMENT_LINKS = ['pdf', 'PDF', 'pptx', 'PPTX'].flatMap((ext) => [`*://*/*.${ext}`, `*://*/*.${ext}?*`]);

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
      browser.contextMenus.create({
        id: OPEN_LINK_ID,
        title: 'Open in Readwell',
        contexts: ['link'],
        targetUrlPatterns: DOCUMENT_LINKS,
      });
    });
  });

  // The content script reads the live selection itself, so the menu and button share one path.
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === OPEN_LINK_ID) {
      if (info.linkUrl && isOpenableUrl(info.linkUrl)) {
        void browser.tabs.create({ url: browser.runtime.getURL(readerPath(info.linkUrl)) });
      }
      return;
    }
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
    const message: ContentMessage = { type: 'simplify-selection' };
    // The reader is an extension page: tabs messaging only reaches content scripts.
    if (info.pageUrl?.startsWith(browser.runtime.getURL(readerPath()))) {
      void browser.runtime.sendMessage(message);
      return;
    }
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
