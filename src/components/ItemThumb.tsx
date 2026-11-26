import {
  itemImage,
  itemInitials,
  rarityHue,
  rarityHueBorderClass,
  type RarityHue,
} from '../utils/itemDisplay';

type ThumbSize = 'sm' | 'md' | 'lg';

const BOX: Record<ThumbSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-14 w-14',
};
const TEXT: Record<ThumbSize, string> = {
  sm: 'text-[9px]',
  md: 'text-[10px]',
  lg: 'text-xs',
};

/**
 * Item thumbnail with rarity-hue border. Missing image → size + initials placeholder.
 * Thin Phase 1–2 hook; Phase 3 owns full tactical grid styling.
 */
export function ItemThumb(props: {
  item: {
    name: string;
    rarity: number;
    size: string;
    iconUrl?: string;
    image?: string;
  };
  hide?: boolean;
  size?: ThumbSize;
  /** Force a hue (defaults from rarity). */
  hue?: RarityHue;
  className?: string;
  /** Highlight isolated 100% lock. */
  lockedHighlight?: boolean;
}) {
  if (props.hide) return null;
  const size = props.size ?? 'sm';
  const hue = props.hue ?? rarityHue(props.item);
  const src = itemImage(props.item);
  const border = rarityHueBorderClass(hue);
  const lockRing = props.lockedHighlight
    ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg)]'
    : '';

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={[
          BOX[size],
          'object-contain rounded bg-black/30 shrink-0 border',
          border,
          lockRing,
          props.className ?? '',
        ].join(' ')}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={[
        BOX[size],
        TEXT[size],
        'rounded bg-black/40 shrink-0 border flex flex-col items-center justify-center gap-0.5 font-semibold uppercase tracking-wide',
        border,
        lockRing,
        hue === 'red'
          ? 'text-[var(--mythic)]'
          : hue === 'yellow'
            ? 'text-[var(--mythic-gold)]'
            : 'text-[#8aa0ff]',
        props.className ?? '',
      ].join(' ')}
      title={props.item.name}
      aria-label={`${props.item.name} (${props.item.size})`}
    >
      <span className="leading-none">{itemInitials(props.item.name)}</span>
      <span className="text-[8px] font-normal opacity-80 leading-none">
        {props.item.size}
      </span>
    </div>
  );
}
