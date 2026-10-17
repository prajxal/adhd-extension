import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimplifyLevel } from '@/src/shared/settings';
import { ResultCard } from '@/src/ui/ResultCard';
import type { RequestState } from '@/src/ui/simplifyFlow';
import { SAMPLE } from './fixtures';

// Tell React this is a test environment so act() works without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(request: RequestState, handlers: Partial<{ onLevel: (l: SimplifyLevel) => void; onRetry: () => void; onClose: () => void }> = {}): void {
  act(() => {
    root.render(
      <ResultCard
        level={2}
        request={request}
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
