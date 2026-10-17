import type { ReactElement } from 'react';

export const PRIVACY_TEXT =
  'Selected text is sent to our server and an AI provider to simplify it. Nothing is sent unless you click Simplify.';

type Props = { onAccept: () => void; onCancel: () => void };

export function PrivacyNotice({ onAccept, onCancel }: Props): ReactElement {
  return (
    <>
      <header className="rw-head">
        <h2 id="rw-dialog-title" className="rw-title">
          Before you simplify
        </h2>
      </header>
      <p className="rw-privacy">{PRIVACY_TEXT}</p>
      <div className="rw-actions">
        <button type="button" className="rw-primary" onClick={onAccept}>
          Continue
        </button>
        <button type="button" className="rw-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
