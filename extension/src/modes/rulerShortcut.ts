import { updateSettings } from '../shared/settings';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Alt+R toggles the ruler while `isActive()` (e.g. the site is turned on). Uses `code`
 * so it works on macOS, where Alt+R types "®", and ignores it while typing in fields.
 */
export function attachRulerShortcut(isActive: () => boolean): void {
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyR') return;
      if (isEditableTarget(event.target) || !isActive()) return;
      event.preventDefault();
      void updateSettings((s) => ({ ...s, ruler: { ...s.ruler, enabled: !s.ruler.enabled } }));
    },
    true,
  );
}
