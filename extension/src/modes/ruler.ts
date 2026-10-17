import { getLayer, removeLayer } from '../ui/shadowHost';

const LAYER_ID = 'rw-ruler';

const RULER_CSS = `
#${LAYER_ID} .dim {
  position: fixed;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.42);
  pointer-events: none;
  transition: none;
}
#${LAYER_ID} .top { top: 0; }
#${LAYER_ID} .bottom { bottom: 0; }
`;

/** Two dimming overlays with a clear band between them that follows the mouse. */
export class Ruler {
  private top: HTMLDivElement | null = null;
  private bottom: HTMLDivElement | null = null;
  private height = 48;
  private y = 0;
  private frame = 0;

  constructor(private readonly doc: Document = document) {}

  get visible(): boolean {
    return this.top !== null;
  }

  show(height: number): void {
    this.height = height;
    if (!this.top) {
      const layer = getLayer(LAYER_ID, RULER_CSS, this.doc);
      this.top = this.doc.createElement('div');
      this.top.className = 'dim top';
      this.bottom = this.doc.createElement('div');
      this.bottom.className = 'dim bottom';
      layer.append(this.top, this.bottom);
      this.y = window.innerHeight / 2;
      window.addEventListener('mousemove', this.onMouseMove, { passive: true });
    }
    this.render();
  }

  hide(): void {
    if (!this.top) return;
    window.removeEventListener('mousemove', this.onMouseMove);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.top = null;
    this.bottom = null;
    removeLayer(LAYER_ID);
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.y = event.clientY;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  private render(): void {
    if (!this.top || !this.bottom) return;
    const half = this.height / 2;
    this.top.style.height = `${Math.max(0, this.y - half)}px`;
    this.bottom.style.top = `${this.y + half}px`;
  }
}
