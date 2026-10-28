import type { MerchantItem } from './audioMatcher';

/** Display order for size-grouped results (exact sizes + rotational pairs). */
export const SIZE_ORDER = ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2'] as const;

export type GridSize = (typeof SIZE_ORDER)[number];

export const SIZE_ROTATION: Record<string, string> = {
  '1x2': '2x1',
  '2x1': '1x2',
  '2x3': '3x2',
  '3x2': '2x3',
};

export interface SizeGroup {
  size: string;
  rotationOf?: string;
  items: MerchantItem[];
  redCount: number;
  redPct: number;
}

export function redLikelihoodPercent(candidates: MerchantItem[]): number {
  if (!candidates.length) return 0;
  const reds = candidates.filter((i) => i.rarity >= 6).length;
  return Math.round((reds / candidates.length) * 1000) / 10;
}

export function sortRedsFirst(items: MerchantItem[]): MerchantItem[] {
  return [...items].sort(
    (a, b) => b.rarity - a.rarity || b.contactPrice - a.contactPrice || a.name.localeCompare(b.name),
  );
}

/** Unique cargo price tiers from item sources, ascending. */
export function cargoPriceTiers(item: MerchantItem): number[] {
  return Array.from(new Set(item.sources.map((s) => s.cargoPrice))).sort((a, b) => a - b);
}

/**
 * Group items that share a matched Sound ID by inventory grid size.
 * Empty sizes are omitted. Rotational partners are labeled.
 */
export function groupItemsBySize(items: MerchantItem[]): SizeGroup[] {
  const bySize = new Map<string, MerchantItem[]>();
  for (const item of items) {
    const list = bySize.get(item.size) ?? [];
    list.push(item);
    bySize.set(item.size, list);
  }

  const sizes = Array.from(bySize.keys()).sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a as GridSize);
    const ib = SIZE_ORDER.indexOf(b as GridSize);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return sizes.map((size) => {
    const groupItems = sortRedsFirst(bySize.get(size) || []);
    const redCount = groupItems.filter((i) => i.rarity >= 6).length;
    return {
      size,
      rotationOf: SIZE_ROTATION[size],
      items: groupItems,
      redCount,
      redPct: redLikelihoodPercent(groupItems),
    };
  });
}
