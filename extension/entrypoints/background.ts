import { loadSettings } from '@/src/shared/settings';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    // Make sure defaults exist in storage so every surface reads the same values.
    void loadSettings();
  });
});
