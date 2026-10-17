import type { SimplifyResponse } from '@/src/shared/api';

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
