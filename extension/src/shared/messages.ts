import type { Settings, SimplifyLevel } from './settings';

/** Popup → content: apply these settings now (no reload). */
export type ApplySettingsMessage = { type: 'apply-settings'; settings: Settings };

/** Popup → content: which hostname is this tab on? */
export type GetHostnameMessage = { type: 'get-hostname' };

/** Background → content: the "Simplify selection" context menu item was clicked. */
export type SimplifySelectionMessage = { type: 'simplify-selection' };

export type ContentMessage = ApplySettingsMessage | GetHostnameMessage | SimplifySelectionMessage;

/** Content → background: call the server. Replies with a SimplifyResult. */
export type SimplifyRequestMessage = { type: 'simplify'; text: string; level: SimplifyLevel };

export type BackgroundMessage = SimplifyRequestMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isContentMessage(value: unknown): value is ContentMessage {
  return (
    isRecord(value) &&
    (value.type === 'apply-settings' ||
      value.type === 'get-hostname' ||
      value.type === 'simplify-selection')
  );
}

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  return (
    isRecord(value) &&
    value.type === 'simplify' &&
    typeof value.text === 'string' &&
    (value.level === 1 || value.level === 2 || value.level === 3)
  );
}
