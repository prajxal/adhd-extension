import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { attachRulerShortcut } from '@/src/modes/rulerShortcut';
import { isContentMessage } from '@/src/shared/messages';
import { attachSimplify } from '@/src/ui/attachSimplify';
import { Reader } from './Reader';
import './reader.css';

// Simplify works on the reader exactly as on web pages. The background sends the
// context-menu click here with runtime messaging (tabs messaging only reaches content scripts).
const { simplifyCurrentSelection } = attachSimplify();
attachRulerShortcut(() => true); // the reader always counts as "turned on"
browser.runtime.onMessage.addListener((message: unknown) => {
  if (isContentMessage(message) && message.type === 'simplify-selection') simplifyCurrentSelection();
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Reader src={new URLSearchParams(window.location.search).get('src')} />
    </StrictMode>,
  );
}
