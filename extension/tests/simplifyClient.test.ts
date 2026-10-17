import { describe, expect, it } from 'vitest';
import { parseSimplifyResponse, parseSimplifyResult } from '@/src/shared/api';
import { requestSimplify } from '@/src/shared/simplifyClient';
import { SAMPLE } from './fixtures';

const SERVER = 'http://localhost:8000';

function fakeFetch(respond: () => Promise<Response>): typeof fetch {
  return () => respond();
}

function json(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('parseSimplifyResponse', () => {
  it('accepts a valid response', () => {
    expect(parseSimplifyResponse(SAMPLE)).toEqual(SAMPLE);
  });

  it('rejects malformed responses', () => {
    expect(parseSimplifyResponse(null)).toBeNull();
    expect(parseSimplifyResponse({ ...SAMPLE, tldr: 3 })).toBeNull();
    expect(parseSimplifyResponse({ ...SAMPLE, simplified: [{ text: 'x', sourceIds: ['1'] }] })).toBeNull();
    expect(parseSimplifyResponse({ ...SAMPLE, readability: { before: 1 } })).toBeNull();
  });

  it('round-trips results passed between scripts', () => {
    expect(parseSimplifyResult({ ok: true, data: SAMPLE })).toEqual({ ok: true, data: SAMPLE });
    expect(parseSimplifyResult({ ok: false, error: 'x' })).toEqual({ ok: false, error: 'x' });
    expect(parseSimplifyResult(undefined)).toBeNull();
  });
});

describe('requestSimplify', () => {
  it('posts text and level, and returns parsed data', async () => {
    let sent: { url: string; body: unknown } | null = null;
    const fetchFn: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      sent = { url, body };
      return json(200, SAMPLE);
    };
    const result = await requestSimplify(SERVER, 'some text here', 3, fetchFn);
    expect(result).toEqual({ ok: true, data: SAMPLE });
    expect(sent).toEqual({ url: `${SERVER}/simplify`, body: { text: 'some text here', level: 3 } });
  });

  it('says the server is not reachable when fetch fails', async () => {
    const result = await requestSimplify(SERVER, 't', 2, fakeFetch(() => Promise.reject(new TypeError('Failed to fetch'))));
    expect(result).toEqual({ ok: false, error: 'Server not reachable at http://localhost:8000' });
  });

  it('times out slow requests', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const result = await requestSimplify(SERVER, 't', 2, hang, 20);
    expect(result).toEqual({ ok: false, error: 'The server took too long to respond. Try again.' });
  });

  it.each([
    [400, { detail: [] }, 'can’t be simplified'],
    [429, { detail: 'x' }, 'Too many requests'],
    [502, { detail: 'The AI returned an invalid response twice. Please try again.' }, 'invalid response twice'],
    [503, {}, 'unavailable'],
    [500, {}, 'Server error (500)'],
  ])('maps HTTP %i to a readable error', async (status, body, expected) => {
    const result = await requestSimplify(SERVER, 't', 2, fakeFetch(() => json(status, body)));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(expected);
  });

  it('rejects an unexpected 200 body', async () => {
    const result = await requestSimplify(SERVER, 't', 2, fakeFetch(() => json(200, { nope: true })));
    expect(result).toEqual({ ok: false, error: 'The server sent an unexpected response.' });
  });
});
