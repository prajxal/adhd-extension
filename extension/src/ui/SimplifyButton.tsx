import type { ReactElement } from 'react';

type Props = { left: number; top: number; onClick: () => void };

export function SimplifyButton({ left, top, onClick }: Props): ReactElement {
  return (
    <button
      type="button"
      className="rw-button"
      style={{ left, top }}
      // Keep the page selection: a normal mousedown would clear it.
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onClick}
    >
      Simplify
    </button>
  );
}

type NoticeProps = { left: number; top: number; message: string };

export function Notice({ left, top, message }: NoticeProps): ReactElement {
  return (
    <div className="rw-notice" role="status" style={{ left, top }}>
      {message}
    </div>
  );
}
