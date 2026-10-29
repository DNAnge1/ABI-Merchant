import type { MerchantItem } from './audioMatcher';

export type TierFilter = {
  onlyRed: boolean;
  onlyYellow: boolean;
};

export type ScoredItem = MerchantItem & {
  /** Match probability within selected sizes (sums ~100 among survivors). */
  displayPct: number;
  sizeExcluded: boolean;
};

/** Red (≥6) / Yellow (≥5 & <6) / other — matches live rarity badges. */
export function itemTier(item: MerchantItem): 'Red' | 'Yellow' | 'Other' {
  if (item.rarity >= 6) return 'Red';
  if (item.rarity >= 5) return 'Yellow';
  return 'Other';
}

export function passesTier(item: MerchantItem, filter: TierFilter): boolean {
  if (!filter.onlyRed && !filter.onlyYellow) return true;
  const tier = itemTier(item);
  if (filter.onlyRed && tier === 'Red') return true;
  if (filter.onlyYellow && tier === 'Yellow') return true;
  return false;
}

/** Sizes present in the locked sound group (never the full game size list). */
export function sizesInGroup(items: MerchantItem[]): string[] {
  return Array.from(new Set(items.map((i) => i.size))).sort();
}

/**
 * After size checkboxes: redistribute probability over remaining items only.
 * Items in a sound group share the same audio lock — equal split among survivors
 * (sums to 100). Wrong size → 0% / excluded. Unchecking all sizes = any size in group.
 */
export function scoreWithinSizes(
  items: MerchantItem[],
  selectedSizes: string[],
): ScoredItem[] {
  const activeSizes =
    selectedSizes.length === 0 ? sizesInGroup(items) : selectedSizes;
  const survivors = items.filter((i) => activeSizes.includes(i.size));
  const n = survivors.length;
  const pctById = new Map<number, number>();
  if (n > 0) {
    const base = Math.floor(100 / n);
    const rem = 100 - base * n;
    survivors.forEach((item, idx) => {
      pctById.set(item.id, base + (idx < rem ? 1 : 0));
    });
  }
  return items.map((item) => {
    const sizeExcluded = !activeSizes.includes(item.size);
    return {
      ...item,
      displayPct: sizeExcluded ? 0 : (pctById.get(item.id) ?? 0),
      sizeExcluded,
    };
  });
}

export function filterScoredFeed(
  scored: ScoredItem[],
  tier: TierFilter,
): ScoredItem[] {
  return scored.filter(
    (item) => passesTier(item, tier) && !item.sizeExcluded && item.displayPct > 0,
  );
}
