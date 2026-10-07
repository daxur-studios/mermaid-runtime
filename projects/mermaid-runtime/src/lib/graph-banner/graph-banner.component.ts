import { ChangeDetectionStrategy, Component, effect, input, output, signal } from "@angular/core";
import type { BannerMessage } from "./banner-message.utils";

/**
 * The banner at the top centre of the canvas.
 *
 * PURPOSE: One slot for the things a viewer should notice: a run result, a way back
 * to the graph, a host's own text.
 *
 * VALUE: Slides down and fades in when a message arrives and back out when it goes.
 * The last message stays in the markup while it fades, so the text does not vanish
 * before the pill does.
 */
@Component({
  selector: "mr-graph-banner",
  templateUrl: "./graph-banner.component.html",
  styleUrl: "./graph-banner.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphBannerComponent {
  /** The message to show, or null to slide the banner away. */
  readonly message = input<BannerMessage | null>(null);

  /** Emits the message when the banner is pressed. */
  readonly activated = output<BannerMessage>();

  /** Last non-empty message, kept so the text stays readable during the slide-out. */
  protected readonly shown = signal<BannerMessage | null>(null);

  constructor() {
    effect(() => {
      const message = this.message();
      if (message) this.shown.set(message);
    });
  }
}
