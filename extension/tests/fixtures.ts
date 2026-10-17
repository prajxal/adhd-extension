import type { CheckResponse, SimplifyResponse } from '@/src/shared/api';

export const SAMPLE: SimplifyResponse = {
  original: [
    { id: 1, text: 'The committee postponed the vote until March 2025.' },
    { id: 2, text: 'Turnout fell by 12.5%.' },
  ],
  simplified: [
    { text: 'The group moved the vote to March 2025.', sourceIds: [1] },
    { text: '12.5% fewer people voted.', sourceIds: [2] },
  ],
  tldr: 'The vote moved to March 2025.',
  glossary: [{ term: 'postponed', definition: 'moved to a later time' }],
  readability: { before: 14.2, after: 7.1 },
  cached: false,
  warnings: [],
};

export const CHECK_OK: CheckResponse = {
  sentences: [
    { index: 0, status: 'ok', reasons: [] },
    { index: 1, status: 'ok', reasons: [] },
  ],
  summary: { ok: 2, check: 0, problem: 0 },
  judge: 'llm',
  cached: false,
};

export const CHECK_FLAGGED: CheckResponse = {
  sentences: [
    { index: 0, status: 'problem', reasons: ['Negation may be lost (original says "not").', 'Says the vote happened.'] },
    { index: 1, status: 'check', reasons: ['May sound more certain than the original ("about").'] },
  ],
  summary: { ok: 0, check: 1, problem: 1 },
  judge: 'llm',
  cached: false,
};
