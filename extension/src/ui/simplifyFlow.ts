import type { SimplifyResponse, SimplifyResult } from '../shared/api';
import type { Settings, SimplifyLevel } from '../shared/settings';
import type { Anchor } from './selection';

export type RequestState =
  | { status: 'loading'; startedAt: number }
  | { status: 'error'; message: string }
  | { status: 'done'; data: SimplifyResponse };

export type UiState =
  | { kind: 'hidden' }
  | { kind: 'button'; text: string; anchor: Anchor }
  | { kind: 'notice'; message: string; anchor: Anchor }
  | { kind: 'privacy'; text: string; level: SimplifyLevel; anchor: Anchor }
  | { kind: 'card'; text: string; level: SimplifyLevel; anchor: Anchor; request: RequestState };

export type FlowDeps = {
  send: (text: string, level: SimplifyLevel) => Promise<SimplifyResult>;
  loadSettings: () => Promise<Settings>;
  acceptPrivacy: () => Promise<void>;
  now?: () => number;
};

/** State machine for the selection button, privacy notice and result card. */
export class SimplifyFlow {
  private state: UiState = { kind: 'hidden' };
  private readonly listeners = new Set<() => void>();
  private requestId = 0;

  constructor(private readonly deps: FlowDeps) {}

  readonly getState = (): UiState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(next: UiState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private get dialogOpen(): boolean {
    return this.state.kind === 'card' || this.state.kind === 'privacy';
  }

  /** New selection: offer the button (but never replace an open card). */
  showButton(text: string, anchor: Anchor): void {
    if (!this.dialogOpen) this.set({ kind: 'button', text, anchor });
  }

  showNotice(message: string, anchor: Anchor): void {
    if (!this.dialogOpen) this.set({ kind: 'notice', message, anchor });
  }

  /** Scroll, cleared selection: hide the button or notice, keep any open card. */
  hideTransient(): void {
    if (this.state.kind === 'button' || this.state.kind === 'notice') this.set({ kind: 'hidden' });
  }

  async start(text: string, anchor: Anchor): Promise<void> {
    const settings = await this.deps.loadSettings();
    if (!settings.privacyNoticeAccepted) {
      this.set({ kind: 'privacy', text, level: settings.simplifyLevel, anchor });
      return;
    }
    await this.request(text, settings.simplifyLevel, anchor);
  }

  async acceptPrivacy(): Promise<void> {
    if (this.state.kind !== 'privacy') return;
    const { text, level, anchor } = this.state;
    await this.deps.acceptPrivacy();
    await this.request(text, level, anchor);
  }

  async retry(): Promise<void> {
    if (this.state.kind !== 'card') return;
    await this.request(this.state.text, this.state.level, this.state.anchor);
  }

  async changeLevel(level: SimplifyLevel): Promise<void> {
    if (this.state.kind !== 'card' || this.state.level === level) return;
    await this.request(this.state.text, level, this.state.anchor);
  }

  close(): void {
    this.requestId++; // any reply still in flight is now stale
    this.set({ kind: 'hidden' });
  }

  /** Escape closes whatever is showing. */
  escape(): boolean {
    if (this.state.kind === 'hidden') return false;
    this.close();
    return true;
  }

  private async request(text: string, level: SimplifyLevel, anchor: Anchor): Promise<void> {
    const id = ++this.requestId;
    const now = this.deps.now ?? Date.now;
    this.set({ kind: 'card', text, level, anchor, request: { status: 'loading', startedAt: now() } });
    let result: SimplifyResult;
    try {
      result = await this.deps.send(text, level);
    } catch {
      result = { ok: false, error: 'The extension couldn’t reach its background worker. Try again.' };
    }
    if (id !== this.requestId || this.state.kind !== 'card') return; // closed or superseded
    this.set({
      ...this.state,
      request: result.ok
        ? { status: 'done', data: result.data }
        : { status: 'error', message: result.error },
    });
  }
}
