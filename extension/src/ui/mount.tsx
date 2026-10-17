import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import cardCss from './card.css?inline';
import { getLayer } from './shadowHost';
import type { SimplifyFlow } from './simplifyFlow';

const LAYER_ID = 'rw-app';

/**
 * Renders the Simplify UI into our shadow root. The React root is only created the first
 * time there is something to show, so pages where Simplify is never used stay untouched.
 */
export function mountSimplifyUi(flow: SimplifyFlow, doc: Document = document): void {
  let root: Root | null = null;
  const ensureRoot = (): void => {
    if (root || flow.getState().kind === 'hidden') return;
    const layer = getLayer(LAYER_ID, cardCss, doc);
    layer.className = 'rw-root';
    root = createRoot(layer);
    root.render(<App flow={flow} />);
  };
  flow.subscribe(ensureRoot);
}
