/** What a node shows in the middle of itself when zoomed far out. */
export interface FarContent {
  /** Whether the node's kind has an icon. */
  readonly hasIcon: boolean;
  /** The kind's short chip text (for example `Kafka`), or an empty string. */
  readonly chip: string;
  /** The percentage and time line (for example `42% · 1m 05s`), or an empty string. */
  readonly readout: string;
}

/** The size of a node's drawn shape, in scene px. */
export interface FarBox {
  readonly width: number;
  readonly height: number;
}

/** Where the kind row (icon and chip) goes, in the node's own coordinates (centre at 0, 0). */
export interface FarKindLayout {
  /** Vertical centre of the row. */
  readonly y: number;
  /** Chip text size. */
  readonly fontSize: number;
  /** Icon side length, or 0 without an icon. */
  readonly iconSize: number;
  /** Left edge of the icon. */
  readonly iconX: number;
  /** Chip pill: its left edge, width and height; width 0 without a chip. */
  readonly chipX: number;
  readonly chipWidth: number;
  readonly chipHeight: number;
}

/** Where the percentage and time line goes. */
export interface FarReadoutLayout {
  /** Vertical centre of the line. */
  readonly y: number;
  readonly fontSize: number;
}

/** The whole arrangement: both rows are optional, and `baseFont` is the size the zoom scaling is worked out from. */
export interface FarLayout {
  readonly kind: FarKindLayout | null;
  readonly readout: FarReadoutLayout | null;
  readonly baseFont: number;
}

/** Share of the node's height the readout's text fills when it has the kind row above it. */
const READOUT_SHARE_WITH_KIND = 0.4;

/** Share of the node's height the chip text fills when the readout is below it. */
const KIND_SHARE_WITH_READOUT = 0.24;

/** Share of the node's height the readout fills when it is the only thing shown. */
const READOUT_SHARE_ALONE = 0.55;

/** Share of the node's height the chip text fills when it is the only thing shown. */
const KIND_SHARE_ALONE = 0.34;

/** Gap between the kind row and the readout, as a share of the node's height. */
const ROW_GAP_SHARE = 0.05;

/** Height of a line of text as a multiple of its font size, for stacking. */
const READOUT_LINE_HEIGHT_RATIO = 1.1;

/** Estimated width of one character as a multiple of the font size (tabular digits, bold). */
const CHAR_WIDTH_RATIO = 0.6;

/** Share of the node's width the content may fill at most. */
const WIDTH_SHARE = 0.84;

/** Icon side as a multiple of the chip's font size when a chip sits beside it, so the icon reads a little larger than the text. */
const ICON_SIZE_RATIO = 1.4;

/** Icon side as a multiple of the (row's) font size when it has no chip but a readout below it. */
const ICON_ALONE_SIZE_RATIO = 1.6;

/** Icon side as a multiple of the (row's) font size when it is the only thing shown. */
const ICON_ONLY_SIZE_RATIO = 2.2;

/** Space between the icon and the chip, as a multiple of the chip's font size. */
const ICON_GAP_RATIO = 0.4;

/** Chip pill height as a multiple of the chip's font size. */
const CHIP_HEIGHT_RATIO = 1.5;

/** Chip pill padding on each side of its text, as a multiple of the chip's font size. */
const CHIP_PADDING_RATIO = 0.5;

/** Width of the kind row (icon, gap, chip pill) for a chip font size. */
function measureKindRow(font: number, hasIcon: boolean, chip: string, hasReadout: boolean): { icon: number; chipWidth: number; total: number } {
  const iconRatio = chip ? ICON_SIZE_RATIO : hasReadout ? ICON_ALONE_SIZE_RATIO : ICON_ONLY_SIZE_RATIO;
  const icon = hasIcon ? font * iconRatio : 0;
  const chipWidth = chip ? chip.length * font * CHAR_WIDTH_RATIO + 2 * font * CHIP_PADDING_RATIO : 0;
  const gap = hasIcon && chip ? font * ICON_GAP_RATIO : 0;
  return { icon, chipWidth, total: icon + gap + chipWidth };
}

/**
 * Lays out what a node shows in its middle when zoomed far out: the kind's icon and chip
 * in a row, with the percentage and time below.
 *
 * PURPOSE: Far out the node's own text is too small to read, but what kind of step it is
 * (a Kafka wait, a SQL poll) and how it is doing still are. This arranges that centred in
 * the node at the largest size that fits, so the stylesheet only has to shrink it with the zoom.
 *
 * VALUE: One tested function owns every size and position, in the node's own
 * coordinates (centre at 0, 0). A row too wide for the node shrinks to fit; a
 * missing row gives its room to the other.
 */
export function computeFarLayout(box: FarBox, content: FarContent): FarLayout {
  const hasKind = content.hasIcon || content.chip !== '';
  const hasReadout = content.readout !== '';
  const maxWidth = box.width * WIDTH_SHARE;

  let readoutFont = (hasKind ? READOUT_SHARE_WITH_KIND : READOUT_SHARE_ALONE) * box.height;
  if (hasReadout) readoutFont = Math.min(readoutFont, maxWidth / (content.readout.length * CHAR_WIDTH_RATIO));

  let kindFont = (hasReadout ? KIND_SHARE_WITH_READOUT : KIND_SHARE_ALONE) * box.height;
  if (hasKind) {
    const row = measureKindRow(kindFont, content.hasIcon, content.chip, hasReadout);
    kindFont *= Math.min(1, maxWidth / row.total);
  }

  const kindRow = hasKind ? measureKindRow(kindFont, content.hasIcon, content.chip, hasReadout) : null;
  const kindHeight = kindRow ? Math.max(kindFont * CHIP_HEIGHT_RATIO, kindRow.icon) : 0;
  const readoutHeight = hasReadout ? readoutFont * READOUT_LINE_HEIGHT_RATIO : 0;
  const gap = hasKind && hasReadout ? ROW_GAP_SHARE * box.height : 0;
  const top = -(kindHeight + gap + readoutHeight) / 2;

  const kind: FarKindLayout | null = kindRow
    ? {
        y: top + kindHeight / 2,
        fontSize: kindFont,
        iconSize: kindRow.icon,
        iconX: -kindRow.total / 2,
        chipX: -kindRow.total / 2 + kindRow.icon + (content.hasIcon && content.chip ? kindFont * ICON_GAP_RATIO : 0),
        chipWidth: kindRow.chipWidth,
        chipHeight: kindFont * CHIP_HEIGHT_RATIO,
      }
    : null;
  const readout: FarReadoutLayout | null = hasReadout ? { y: top + kindHeight + gap + readoutHeight / 2, fontSize: readoutFont } : null;
  return { kind, readout, baseFont: hasReadout ? readoutFont : kindFont };
}
