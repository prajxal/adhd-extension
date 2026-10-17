import { parseSimplifyResponse, type SimplifyResult } from './api';
import type { SimplifyLevel } from './settings';

/** The server may try several models in turn, so allow it plenty of time. */
export const REQUEST_TIMEOUT_MS = 120_000;

async function readDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      return typeof body.detail === 'string' ? body.detail : null;
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/** Runs in the background service worker: the only place that talks to the server. */
export async function requestSimplify(
  serverUrl: string,
  text: string,
  level: SimplifyLevel,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<SimplifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(`${serverUrl}/simplify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, level }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return controller.signal.aborted
      ? { ok: false, error: 'The server took too long to respond. Try again.' }
      : { ok: false, error: `Server not reachable at ${serverUrl}` };
  }
  clearTimeout(timer);

  if (!response.ok) {
    const detail = await readDetail(response);
    switch (response.status) {
      case 400:
        return { ok: false, error: 'This passage can’t be simplified. Select 20–3000 characters of text.' };
      case 429:
        return { ok: false, error: 'Too many requests. Wait a minute and try again.' };
      case 502:
      case 503:
        return { ok: false, error: detail ?? 'The AI service is unavailable right now. Try again.' };
      default:
        return { ok: false, error: `Server error (${response.status}). Try again.` };
    }
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const data = parseSimplifyResponse(body);
  return data ? { ok: true, data } : { ok: false, error: 'The server sent an unexpected response.' };
}
