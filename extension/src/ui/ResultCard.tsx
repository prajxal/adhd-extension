import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { SimplifyResponse } from '../shared/api';
import type { SimplifyLevel } from '../shared/settings';
import type { RequestState } from './simplifyFlow';

export const SLOW_AFTER_MS = 10_000;
const LEVELS: readonly SimplifyLevel[] = [1, 2, 3];
const LEVEL_NAMES: Record<SimplifyLevel, string> = { 1: 'Light', 2: 'Plain', 3: 'Simplest' };

type Props = {
  level: SimplifyLevel;
  request: RequestState;
  onLevel: (level: SimplifyLevel) => void;
  onRetry: () => void;
  onClose: () => void;
};

export function ResultCard({ level, request, onLevel, onRetry, onClose }: Props): ReactElement {
  return (
    <>
      <header className="rw-head">
        <h2 id="rw-dialog-title" className="rw-title">
          Simplified
        </h2>
        <LevelSwitcher level={level} onLevel={onLevel} />
        <button type="button" className="rw-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {request.status === 'loading' && <Loading startedAt={request.startedAt} />}
      {request.status === 'error' && (
        <div className="rw-error" role="alert">
          <p>{request.message}</p>
          <button type="button" className="rw-primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {request.status === 'done' && <Result data={request.data} />}
    </>
  );
}

function LevelSwitcher({
  level,
  onLevel,
}: {
  level: SimplifyLevel;
  onLevel: (level: SimplifyLevel) => void;
}): ReactElement {
  // Radio group keyboard pattern: arrow keys move, Tab leaves the group.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = LEVELS[(LEVELS.indexOf(level) + step + LEVELS.length) % LEVELS.length] ?? level;
    onLevel(next);
    const target = e.currentTarget.querySelector<HTMLButtonElement>(`[data-level="${next}"]`);
    target?.focus();
  };

  return (
    <div className="rw-levels" role="radiogroup" aria-label="Simplify level" onKeyDown={onKeyDown}>
      {LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          data-level={l}
          aria-checked={l === level}
          aria-label={`Level ${l}: ${LEVEL_NAMES[l]}`}
          title={LEVEL_NAMES[l]}
          tabIndex={l === level ? 0 : -1}
          onClick={() => {
            onLevel(l);
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Loading({ startedAt }: { startedAt: number }): ReactElement {
  const [slow, setSlow] = useState(() => Date.now() - startedAt >= SLOW_AFTER_MS);
  useEffect(() => {
    const wait = Math.max(0, SLOW_AFTER_MS - (Date.now() - startedAt));
    const timer = setTimeout(() => {
      setSlow(true);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [startedAt]);

  return (
    <p className="rw-status" role="status" aria-live="polite">
      <span className="rw-spinner" aria-hidden="true" />
      {slow ? 'Still working — the AI is slow right now…' : 'Simplifying…'}
    </p>
  );
}

function grade(value: number): string {
  return `Grade ${Math.round(value)}`;
}

function Result({ data }: { data: SimplifyResponse }): ReactElement {
  const [openSentence, setOpenSentence] = useState<number | null>(null);
  const [openTerm, setOpenTerm] = useState<number | null>(null);
  const originals = useMemo(() => new Map(data.original.map((s) => [s.id, s.text])), [data]);
  const term = openTerm === null ? undefined : data.glossary[openTerm];

  return (
    <div className="rw-result">
      <p className="rw-tldr">
        <span className="rw-label">TL;DR</span> {data.tldr}
      </p>
      <p
        className="rw-grade"
        aria-label={`Reading level: from grade ${Math.round(data.readability.before)} to grade ${Math.round(data.readability.after)}`}
      >
        {grade(data.readability.before)} → {grade(data.readability.after)}
      </p>

      <ol className="rw-sentences">
        {data.simplified.map((sentence, i) => {
          const open = openSentence === i;
          return (
            <li key={i}>
              <button
                type="button"
                className="rw-sentence"
                aria-expanded={open}
                aria-controls={`rw-src-${i}`}
                onClick={() => {
                  setOpenSentence(open ? null : i);
                }}
              >
                {sentence.text}
              </button>
              {open && (
                <div className="rw-sources" id={`rw-src-${i}`}>
                  <span className="rw-label">Original</span>
                  {sentence.sourceIds.map((id) => (
                    <mark key={id}>{originals.get(id)}</mark>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {data.glossary.length > 0 && (
        <div className="rw-glossary">
          <span className="rw-label">Words</span>
          <div className="rw-chips">
            {data.glossary.map((entry, i) => (
              <button
                key={entry.term}
                type="button"
                className="rw-chip"
                aria-expanded={openTerm === i}
                aria-controls="rw-definition"
                onClick={() => {
                  setOpenTerm(openTerm === i ? null : i);
                }}
              >
                {entry.term}
              </button>
            ))}
          </div>
          {term && (
            <p className="rw-definition" id="rw-definition">
              <strong>{term.term}</strong>: {term.definition}
            </p>
          )}
        </div>
      )}

      {data.warnings.length > 0 && (
        <ul className="rw-warnings" aria-label="Warnings">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
