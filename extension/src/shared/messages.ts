import type { Settings } from './settings';

/** Popup → content: apply these settings now (no reload). */
export type ApplySettingsMessage = { type: 'apply-settings'; settings: Settings };

/** Popup → content: which hostname is this tab on? */
export type GetHostnameMessage = { type: 'get-hostname' };

export type ContentMessage = ApplySettingsMessage | GetHostnameMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isContentMessage(value: unknown): value is ContentMessage {
  return (
    isRecord(value) && (value.type === 'apply-settings' || value.type === 'get-hostname')
  );
}
