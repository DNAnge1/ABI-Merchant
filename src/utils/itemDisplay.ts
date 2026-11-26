/**
 * Phase 1 display helpers for merchant items.
 * JSON keeps numeric `rarity` + `iconUrl`; UI maps hue / image via these helpers.
 */

import { assetUrl } from './assetUrl';

export type RarityHue = 'red' | 'yellow' | 'blue';

export type ItemDisplaySource = {
  name: string;
  rarity: number;
  size: string;
  iconUrl?: string;
  /** Optional local/CDN path; preferred when present. */
  image?: string;
};

/** Mythic (≥6) → red, Legendary/Gold (≥5) → yellow, Purple/Blue/lower → blue. */
export function rarityHue(item: { rarity: number }): RarityHue {
  if (item.rarity >= 6) return 'red';
  if (item.rarity >= 5) return 'yellow';
  return 'blue';
}

/** Prefer `image`, then `iconUrl`. Local `/icons/…` paths get Vite `base` via assetUrl. */
export function itemImage(item: { iconUrl?: string; image?: string }): string | null {
  const src = item.image?.trim() || item.iconUrl?.trim();
  if (!src) return null;
  return assetUrl(src);
}

/** Initials for placeholder tiles (up to 2 chars from name words). */
export function itemInitials(name: string): string {
  const parts = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Tailwind border/tint classes for rarity hue (thin Phase-1/2 hooks for Phase 3 HUD). */
export function rarityHueBorderClass(hue: RarityHue): string {
  switch (hue) {
    case 'red':
      return 'border-[var(--mythic)]/70 shadow-[0_0_6px_rgba(255,59,74,0.35)]';
    case 'yellow':
      return 'border-[var(--mythic-gold)]/70 shadow-[0_0_6px_rgba(245,197,66,0.28)]';
    default:
      return 'border-[#6b8cff]/55 shadow-[0_0_4px_rgba(107,140,255,0.2)]';
  }
}

export function rarityHueTextClass(hue: RarityHue): string {
  switch (hue) {
    case 'red':
      return 'text-[var(--mythic)]';
    case 'yellow':
      return 'text-[var(--mythic-gold)]';
    default:
      return 'text-[#8aa0ff]';
  }
}
