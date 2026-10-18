import { isSiteEnabled, type Settings } from '../shared/settings';
import { BoldPrefixController } from './boldPrefixDom';
import { Ruler } from './ruler';
import { disableSpacing, enableSpacing } from './spacing';

const INTENSITY_DEBOUNCE_MS = 250;

/**
 * Turns the three visual modes on and off to match settings.
 * A mode runs only if it is enabled and the current site is in `enabledSites`.
 */
export class VisualModes {
  private readonly bold: BoldPrefixController;
  private readonly ruler: Ruler;
  private boldIntensity: number | null = null; // null = bold-prefix is off
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly hostname: string,
    private readonly doc: Document = document,
    root?: Element,
  ) {
    this.bold = new BoldPrefixController(doc, root);
    this.ruler = new Ruler(doc);
  }

  apply(settings: Settings): void {
    const siteOn = isSiteEnabled(settings, this.hostname);

    const wantBold = siteOn && settings.boldPrefix.enabled;
    const intensity = settings.boldPrefix.intensity;
    if (!wantBold) {
      this.clearRestart();
      if (this.boldIntensity !== null) {
        this.boldIntensity = null;
        void this.bold.disable();
      }
    } else if (this.boldIntensity === null) {
      this.boldIntensity = intensity;
      void this.bold.enable(intensity);
    } else if (this.boldIntensity !== intensity) {
      // Slider drags send many updates; re-render once it settles.
      this.boldIntensity = intensity;
      this.clearRestart();
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        void this.bold.restart(intensity);
      }, INTENSITY_DEBOUNCE_MS);
    }

    if (siteOn && settings.ruler.enabled) this.ruler.show(settings.ruler.height);
    else this.ruler.hide();

    if (siteOn && settings.spacing.enabled) enableSpacing(this.doc);
    else disableSpacing(this.doc);
  }

  private clearRestart(): void {
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
}
