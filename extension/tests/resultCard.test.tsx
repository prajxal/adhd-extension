import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimplifyLevel } from '@/src/shared/settings';
import { checkSummary, ResultCard } from '@/src/ui/ResultCard';
import type { CheckState, RequestState } from '@/src/ui/simplifyFlow';
import { CHECK_FLAGGED, CHECK_OK, CHECK_REPAIRED, SAMPLE } from './fixtures';

// Tell React this is a test environment so act() works without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(
  request: RequestState,
  handlers: Partial<{ onLevel: (l: SimplifyLevel) => void; onRetry: () => void; onClose: () => void }> = {},
  check: CheckState = { status: 'idle' },
): void {
  act(() => {
    root.render(
      <ResultCard
        level={2}
        request={request}
        check={check}
        onLevel={handlers.onLevel ?? (() => undefined)}
        onRetry={handlers.onRetry ?? (() => undefined)}
        onClose={handlers.onClose ?? (() => undefined)}
      />,
    );
  });
}

function click(el: Element | null | undefined): void {
  if (!el) throw new Error('element not found');
  act(() => {
    (el as HTMLElement).click();
  });
}

describe('ResultCard', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows TL;DR, readability and sentences', () => {
    render({ status: 'done', data: SAMPLE });
    expect(container.querySelector('.rw-tldr')?.textContent).toContain('The vote moved to March 2025.');
    expect(container.querySelector('.rw-grade')?.textContent).toBe('Grade 14 → Grade 7');
    expect(container.querySelectorAll('.rw-sentence')).toHaveLength(2);
  });

  it('expands a sentence to show its highlighted source', () => {
    render({ status: 'done', data: SAMPLE });
    const first = container.querySelector('.rw-sentence');
    expect(first?.getAttribute('aria-expanded')).toBe('false');
    click(first);
    expect(first?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.rw-sources mark')?.textContent).toBe(
      'The committee postponed the vote until March 2025.',
    );
  });

  it('shows a definition when a glossary chip is clicked', () => {
    render({ status: 'done', data: SAMPLE });
    click(container.querySelector('.rw-chip'));
    expect(container.querySelector('.rw-definition')?.textContent).toBe('postponed: moved to a later time');
  });

  it('shows warnings subtly when present', () => {
    render({ status: 'done', data: { ...SAMPLE, warnings: ['Some details may be missing (original sentences not covered: 2).'] } });
    expect(container.querySelector('.rw-warnings li')?.textContent).toContain('Some details may be missing');
  });

  it('shows loading, then a slow message after 10s', () => {
    vi.useFakeTimers();
    render({ status: 'loading', startedAt: Date.now() });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Simplifying…');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Still working');
    vi.useRealTimers();
  });

  it('shows errors with a working retry button', () => {
    const onRetry = vi.fn();
    render({ status: 'error', message: 'Server not reachable at http://localhost:8000' }, { onRetry });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Server not reachable at http://localhost:8000');
    click(container.querySelector('.rw-error button'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('level switcher works by click and arrow keys, close button closes', () => {
    const onLevel = vi.fn();
    const onClose = vi.fn();
    render({ status: 'done', data: SAMPLE }, { onLevel, onClose });
    const radios = container.querySelectorAll('[role="radio"]');
    expect([...radios].map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    click(radios[2]);
    expect(onLevel).toHaveBeenLastCalledWith(3);
    act(() => {
      container.querySelector('[role="radiogroup"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(onLevel).toHaveBeenLastCalledWith(1);
    click(container.querySelector('[aria-label="Close"]'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('ResultCard meaning check', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const done = { status: 'done', data: SAMPLE } as const;
  const summaryText = (): string | null | undefined => container.querySelector('.rw-check-summary')?.textContent;

  it('summarises every check state', () => {
    expect(checkSummary({ status: 'idle' })).toBeNull();
    expect(checkSummary({ status: 'off' })).toBeNull();
    expect(checkSummary({ status: 'loading' })).toBe('Checking meaning…');
    expect(checkSummary({ status: 'unavailable' })).toBe('Meaning check unavailable');
    expect(checkSummary({ status: 'done', data: CHECK_OK })).toBe('✓ Meaning check passed');
    expect(checkSummary({ status: 'done', data: CHECK_FLAGGED })).toBe('1 sentence may have changed meaning');
    expect(checkSummary({ status: 'done', data: { ...CHECK_FLAGGED, summary: { ok: 0, check: 2, problem: 0, repaired: 0 } } })).toBe(
      '2 sentences to double-check',
    );
    expect(checkSummary({ status: 'done', data: { ...CHECK_OK, judge: 'rules' } })).toBe(
      '✓ Meaning check passed (basic check only)',
    );
  });

  it('hides the check UI when the server has it turned off', () => {
    render(done, {}, { status: 'off' });
    expect(container.querySelector('.rw-check-summary')).toBeNull();
    expect(container.querySelector('.rw-flag')).toBeNull();
  });

  it('shows a live status line while checking', () => {
    render(done, {}, { status: 'loading' });
    expect(summaryText()).toBe('Checking meaning…');
    expect(container.querySelector('.rw-check-summary')?.getAttribute('aria-live')).toBe('polite');
  });

  it('marks flagged sentences with a visible marker and a screen-reader label', () => {
    render(done, {}, { status: 'done', data: CHECK_FLAGGED });
    expect(summaryText()).toBe('1 sentence may have changed meaning');
    const sentences = container.querySelectorAll('.rw-sentence');
    expect(sentences[0]?.querySelector('.rw-flag')?.textContent).toBe('⚠');
    expect(sentences[0]?.querySelector('.rw-sr')?.textContent).toBe('Possible meaning change: ');
    expect(sentences[1]?.querySelector('.rw-flag')?.textContent).toBe('•');
    expect(sentences[1]?.querySelector('.rw-sr')?.textContent).toBe('Double-check: ');
  });

  it('shows the reasons above the original when a flagged sentence is expanded', () => {
    render(done, {}, { status: 'done', data: CHECK_FLAGGED });
    click(container.querySelector('.rw-sentence'));
    const reasons = [...container.querySelectorAll('.rw-reasons li')].map((li) => li.textContent);
    expect(reasons).toEqual(['Negation may be lost (original says "not").', 'Says the vote happened.']);
    const sources = container.querySelector('.rw-sources');
    expect(sources?.firstElementChild?.className).toBe('rw-reasons');
    expect(sources?.querySelector('mark')).not.toBeNull();
  });

  it('puts the number of fixed sentences in front of the summary', () => {
    expect(checkSummary({ status: 'done', data: CHECK_REPAIRED })).toBe('1 sentence fixed · 1 sentence to double-check');
    const allFixed = { ...CHECK_REPAIRED, summary: { ok: 2, check: 0, problem: 0, repaired: 2 } };
    expect(checkSummary({ status: 'done', data: allFixed })).toBe('2 sentences fixed · ✓ Meaning check passed');
  });

  it('shows the repaired text with a Fixed marker in place of the original sentence', () => {
    render(done, {}, { status: 'done', data: CHECK_REPAIRED });
    const first = container.querySelectorAll('.rw-sentence')[0];
    expect(first?.textContent).toBe('✎Fixed: The committee moved the vote to March 2025.');
    expect(first?.querySelector('.rw-flag-fixed')?.getAttribute('aria-hidden')).toBe('true');
    expect(first?.textContent).not.toContain('The group moved the vote');
    expect(first?.querySelector('.rw-flag-problem, .rw-flag-check')).toBeNull(); // now ok
  });

  it('expanding a fixed sentence shows what was fixed, the earlier version and the original', () => {
    render(done, {}, { status: 'done', data: CHECK_REPAIRED });
    click(container.querySelector('.rw-sentence'));
    const sources = container.querySelector('.rw-sources');
    expect([...(sources?.querySelectorAll('.rw-fixed li') ?? [])].map((li) => li.textContent)).toEqual([
      'Number check: "2025" from the original is missing.',
      'Changes the month.',
    ]);
    expect(sources?.querySelector('.rw-previous')?.textContent).toBe('The group moved the vote to May 2025.');
    expect(sources?.querySelector('mark')?.textContent).toBe('The committee postponed the vote until March 2025.');
    expect(sources?.querySelector('.rw-reasons')).toBeNull(); // nothing left to flag
  });

  it('a fixed sentence that still needs a double-check shows both markers', () => {
    const [repaired] = CHECK_REPAIRED.sentences;
    if (!repaired) throw new Error('fixture needs a repaired sentence');
    const fixedButCheck = {
      ...CHECK_REPAIRED,
      sentences: [{ ...repaired, status: 'check' as const, reasons: ['Drops a detail.'] }],
    };
    render(done, {}, { status: 'done', data: fixedButCheck });
    const first = container.querySelector('.rw-sentence');
    expect(first?.querySelector('.rw-flag-fixed')).not.toBeNull();
    expect(first?.querySelector('.rw-flag-check')).not.toBeNull();
    click(first);
    expect(container.querySelector('.rw-reasons li')?.textContent).toBe('Drops a detail.');
  });

  it('shows no markers when every sentence passed', () => {
    render(done, {}, { status: 'done', data: CHECK_OK });
    expect(summaryText()).toBe('✓ Meaning check passed');
    expect(container.querySelector('.rw-flag')).toBeNull();
  });
});
