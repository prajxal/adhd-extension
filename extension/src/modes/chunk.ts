export type ChunkJob = { cancel: () => void; done: Promise<void> };

/** About 200 nodes per chunk, and never more than ~8ms, well under the 50ms long-task line. */
export const MAX_ITEMS_PER_CHUNK = 200;
export const CHUNK_BUDGET_MS = 8;

/**
 * Calls `step` repeatedly in small idle-time chunks until it returns false.
 * `step` does one unit of work and returns whether there is more.
 */
export function runChunked(step: () => boolean): ChunkJob {
  let cancelled = false;
  let idleHandle: number | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let finish: () => void = () => undefined;

  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const tick = (): void => {
    idleHandle = null;
    timeoutHandle = null;
    if (cancelled) return;
    const start = performance.now();
    let more = true;
    for (let n = 0; more && n < MAX_ITEMS_PER_CHUNK; n++) {
      more = step();
      if (performance.now() - start > CHUNK_BUDGET_MS) break;
    }
    if (more) schedule();
    else finish();
  };

  const schedule = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(tick, { timeout: 500 });
    } else {
      timeoutHandle = setTimeout(tick, 0);
    }
  };

  schedule();

  return {
    done,
    cancel: () => {
      cancelled = true;
      if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      finish();
    },
  };
}
