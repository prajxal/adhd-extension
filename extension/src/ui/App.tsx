import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { PrivacyNotice } from './PrivacyNotice';
import { placeNear } from './position';
import { ResultCard } from './ResultCard';
import type { Anchor } from './selection';
import { Notice, SimplifyButton } from './SimplifyButton';
import type { SimplifyFlow } from './simplifyFlow';

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function App({ flow }: { flow: SimplifyFlow }): ReactElement | null {
  const state = useSyncExternalStore(flow.subscribe, flow.getState);

  switch (state.kind) {
    case 'hidden':
      return null;
    case 'button': {
      const { left, top } = placeNear(state.anchor, { width: 96, height: 34 }, viewport(), 6);
      return (
        <SimplifyButton
          left={left}
          top={top}
          onClick={() => {
            void flow.start(state.text, state.anchor);
          }}
        />
      );
    }
    case 'notice': {
      const { left, top } = placeNear(state.anchor, { width: 320, height: 40 }, viewport(), 6);
      return <Notice left={left} top={top} message={state.message} />;
    }
    case 'privacy':
      return (
        <Dialog key="privacy" anchor={state.anchor}>
          <PrivacyNotice
            onAccept={() => {
              void flow.acceptPrivacy();
            }}
            onCancel={() => {
              flow.close();
            }}
          />
        </Dialog>
      );
    case 'card':
      return (
        <Dialog key="card" anchor={state.anchor}>
          <ResultCard
            level={state.level}
            request={state.request}
            onLevel={(level) => {
              void flow.changeLevel(level);
            }}
            onRetry={() => {
              void flow.retry();
            }}
            onClose={() => {
              flow.close();
            }}
          />
        </Dialog>
      );
  }
}

/** Shared frame for the privacy notice and result card: positioning and focus handling. */
function Dialog({
  anchor,
  children,
}: {
  anchor: Anchor;
  children: ReactElement;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Measure, then place near the selection (below if it fits, else above).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = placeNear(anchor, { width: rect.width, height: rect.height }, viewport());
    // Content height changes (loading → result), so re-measure, but only update on a real move.
    setPosition((prev) => (prev?.left === next.left && prev.top === next.top ? prev : next));
  }, [anchor, children]);

  // Give focus back to whatever had it when the dialog closes.
  useLayoutEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // Move focus in once the dialog is placed: while it is still `visibility: hidden`
  // (before the first measurement) the browser refuses to focus it.
  const placed = position !== null;
  useLayoutEffect(() => {
    if (placed) ref.current?.focus();
  }, [placed]);

  return (
    <div
      ref={ref}
      className="rw-card"
      role="dialog"
      aria-modal="false"
      aria-labelledby="rw-dialog-title"
      tabIndex={-1}
      style={position ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>
  );
}
