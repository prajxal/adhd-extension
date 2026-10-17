import { boldPrefix } from './boldPrefix';
import { runChunked, type ChunkJob } from './chunk';
import { addPageStyle, removePageStyle } from './pageStyle';
import { HOST_ATTR } from '../ui/shadowHost';

export const SKIP_TAGS = [
  'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option', 'code', 'pre',
  'kbd', 'samp', 'math', 'svg', 'canvas', 'iframe',
] as const;

const SKIP_TAG_SET = new Set<string>(SKIP_TAGS);
const EXCLUDE_SELECTOR = [...SKIP_TAGS, '[contenteditable]', `[${HOST_ATTR}]`, '[data-rw]'].join(',');
const HAS_LETTER = /\p{L}/u;
const BOLD_STYLE_ID = 'rw-bold';
// Explicit weight, so the prefix is bold even where the page restyles <b>.
const BOLD_CSS = 'b.rw-b[data-rw="b"] { font-weight: 700; font-style: inherit; color: inherit; }';
const MUTATION_DEBOUNCE_MS = 300;

function isExcludedElement(el: Element): boolean {
  return (
    SKIP_TAG_SET.has(el.localName) ||
    el.hasAttribute('contenteditable') ||
    el.hasAttribute(HOST_ATTR) ||
    el.hasAttribute('data-rw')
  );
}

/** True if the node sits inside something we must never touch (or inside our own output). */
function isExcluded(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el === null || el.closest(EXCLUDE_SELECTOR) !== null;
}

function isCandidateText(node: Text): boolean {
  return HAS_LETTER.test(node.data);
}

/**
 * Applies bold-prefix to the page and reverses it exactly.
 * Every wrapped text node is kept in a WeakMap, and turning off puts the same node back.
 */
export class BoldPrefixController {
  private readonly originals = new WeakMap<HTMLElement, Text>();
  private intensity = 0.45;
  private active = false;
  private job: ChunkJob | null = null;
  private roots: Node[] = [];
  private walker: TreeWalker | null = null;
  private next: Text | null = null;
  private observer: MutationObserver | null = null;
  private pendingAdded = new Set<Node>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly doc: Document = document) {}

  get isActive(): boolean {
    return this.active;
  }

  /** Resolves once the initial pass over the page is finished. */
  enable(intensity: number): Promise<void> {
    return this.enqueue(() => {
      this.start(intensity);
      return Promise.resolve();
    }).then(() => this.whenIdle());
  }

  /** Resolves once every wrapped node has been restored. */
  disable(): Promise<void> {
    return this.enqueue(() => this.stop());
  }

  restart(intensity: number): Promise<void> {
    return this.enqueue(async () => {
      await this.stop();
      this.start(intensity);
    }).then(() => this.whenIdle());
  }

  /** Resolves when no chunked work is pending (used by tests and restart). */
  whenIdle(): Promise<void> {
    return this.job?.done ?? Promise.resolve();
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(op, op);
    return this.queue;
  }

  private start(intensity: number): void {
    if (this.active) return;
    this.active = true;
    this.intensity = intensity;
    addPageStyle(BOLD_STYLE_ID, BOLD_CSS, this.doc);
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(this.doc.body, { childList: true, subtree: true });
    this.process([this.doc.body]);
  }

  private async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingAdded.clear();
    this.job?.cancel();
    this.job = null;
    this.roots = [];
    this.walker = null;
    this.next = null;

    const spans = Array.from(this.doc.querySelectorAll<HTMLElement>('span[data-rw="bp"]'));
    let i = 0;
    const restoreJob = runChunked(() => {
      const span = spans[i++];
      if (span) this.restore(span);
      return i < spans.length;
    });
    await restoreJob.done;
    removePageStyle(BOLD_STYLE_ID, this.doc);
  }

  private process(roots: Node[]): void {
    this.roots.push(...roots);
    if (this.job) return;
    const job = runChunked(this.step);
    this.job = job;
    void job.done.then(() => {
      if (this.job === job) this.job = null;
    });
  }

  /** Wraps one text node. Returns false when there is nothing left to do. */
  private readonly step = (): boolean => {
    while (this.next === null) {
      const root = this.roots.shift();
      if (root === undefined) return false;
      if (!root.isConnected || isExcluded(root)) continue;
      if (root instanceof Text) {
        this.walker = null;
        this.next = isCandidateText(root) ? root : null;
      } else {
        this.walker = this.doc.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
          { acceptNode: filterNode },
        );
        this.next = this.walker.nextNode() as Text | null;
      }
    }
    const node = this.next;
    // Look ahead before replacing `node`: the walker can't move on from a detached node.
    this.next = this.walker ? (this.walker.nextNode() as Text | null) : null;
    if (node.isConnected) this.wrap(node);
    return true;
  };

  private wrap(node: Text): void {
    const segments = boldPrefix(node.data, this.intensity);
    if (!segments.some((s) => s.bold)) return;
    const span = this.doc.createElement('span');
    span.dataset.rw = 'bp';
    for (const segment of segments) {
      if (segment.bold) {
        const b = this.doc.createElement('b');
        b.className = 'rw-b';
        b.dataset.rw = 'b';
        b.textContent = segment.text;
        span.append(b);
      } else {
        span.append(this.doc.createTextNode(segment.text));
      }
    }
    this.originals.set(span, node);
    node.replaceWith(span);
  }

  private restore(span: HTMLElement): void {
    if (!span.isConnected) return;
    const text = span.textContent;
    const original = this.originals.get(span);
    if (original) {
      // If the page changed the text while we were on, keep its latest version.
      if (original.data !== text) original.data = text;
      span.replaceWith(original);
    } else {
      // Left over from an earlier instance of the extension (e.g. after a reload).
      span.replaceWith(this.doc.createTextNode(text));
    }
  }

  private readonly onMutations = (records: MutationRecord[]): void => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.hasAttribute('data-rw')) continue; // our own spans
        if (node instanceof Element || node instanceof Text) this.pendingAdded.add(node);
      }
    }
    if (this.pendingAdded.size === 0 || this.debounceTimer !== null) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.active) return;
      const added = [...this.pendingAdded];
      this.pendingAdded.clear();
      this.process(added);
    }, MUTATION_DEBOUNCE_MS);
  };
}

function filterNode(node: Node): number {
  if (node instanceof Text) {
    return /\S/.test(node.data) && isCandidateText(node)
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT;
  }
  if (node instanceof Element && isExcludedElement(node)) return NodeFilter.FILTER_REJECT;
  return NodeFilter.FILTER_SKIP;
}
