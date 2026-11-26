/**
 * Map/mode raid pools + weighted probability / EV / payback.
 * Pool weights come from public explorer data baked into merchantData.json.
 */

import type { MerchantItem, MerchantItemSource, MatchResult } from './audioMatcher';

export type MapModeOption = {
  id: string;
  name: string;
  profileId: number;
  mapName: string;
  mode: string;
};

/** Result-card price pills — coarse buckets, not every exact cargo price. */
export type CargoPriceBucket = '' | 'lt50k' | '100k' | '200k' | 'gt200k';

export const CARGO_PRICE_BUCKETS: ReadonlyArray<{
  id: CargoPriceBucket;
  label: string;
  /** Inclusive min; null = no lower bound. */
  min: number | null;
  /** Inclusive max; null = no upper bound. */
  max: number | null;
  /** Representative cost for EV / payback when this bucket is selected. */
  costBasis: number | '';
}> = [
  { id: '', label: 'Any', min: null, max: null, costBasis: '' },
  { id: 'lt50k', label: '<50k', min: 0, max: 49_999, costBasis: 30_000 },
  { id: '100k', label: '100k', min: 50_000, max: 149_999, costBasis: 100_000 },
  { id: '200k', label: '200k', min: 150_000, max: 200_000, costBasis: 200_000 },
  { id: 'gt200k', label: '>200k', min: 200_001, max: null, costBasis: 350_000 },
];

export function cargoPriceMatchesBucket(
  price: number,
  bucket: CargoPriceBucket | undefined,
): boolean {
  if (!bucket) return true;
  const b = CARGO_PRICE_BUCKETS.find((x) => x.id === bucket);
  if (!b || (b.min == null && b.max == null)) return true;
  if (b.min != null && price < b.min) return false;
  if (b.max != null && price > b.max) return false;
  return true;
}

export function costBasisForBucket(bucket: CargoPriceBucket | undefined): number | '' {
  const b = CARGO_PRICE_BUCKETS.find((x) => x.id === (bucket ?? ''));
  return b?.costBasis ?? '';
}

export type RaidFilter = {
  /** Explorer map/mode id, e.g. "Farm Lockdown". Empty = all profiles. */
  mapModeId?: string;
  profileId?: number;
  size?: string;
  /** Multi-select sizes (listen feed); empty = any. */
  sizes?: string[];
  cargoType?: string;
  /** Exact price (Manual). Prefer cargoPriceBucket on the Catch result card. */
  cargoPrice?: number | '';
  /** Coarse price range for Catch HUD pills. */
  cargoPriceBucket?: CargoPriceBucket;
};

export type WeightedScoredItem = MerchantItem & {
  displayPct: number;
  sizeExcluded: boolean;
  poolWeight: number;
};

export type EvSummary = {
  /** Σ pᵢ · contactPriceᵢ */
  expectedValue: number;
  /** Cargo price used as cost basis (0 if unknown). */
  cargoPrice: number;
  /** (EV / cargoPrice) × 100; null when no cargo price. 100 = break-even. */
  paybackPercent: number | null;
  /** Probability of contactPrice > cargoPrice. */
  profitChancePercent: number | null;
};

function activeSizes(filter: RaidFilter): string[] | null {
  if (filter.sizes && filter.sizes.length > 0) return filter.sizes;
  if (filter.size) return [filter.size];
  return null;
}

/** Resolve profileId from mapModes table + filter. */
export function resolveProfileId(
  filter: RaidFilter,
  mapModes: MapModeOption[],
): number | undefined {
  if (filter.profileId != null) return filter.profileId;
  if (!filter.mapModeId) return undefined;
  const hit = mapModes.find((m) => m.id === filter.mapModeId);
  return hit?.profileId;
}

function sourceMatches(
  s: MerchantItemSource,
  filter: RaidFilter,
  profileId?: number,
): boolean {
  if (profileId != null && s.profileId != null && s.profileId !== profileId) {
    return false;
  }
  if (filter.cargoType && s.cargoType !== filter.cargoType) return false;
  if (filter.cargoPriceBucket) {
    if (!cargoPriceMatchesBucket(s.cargoPrice, filter.cargoPriceBucket)) return false;
  } else if (
    filter.cargoPrice !== undefined &&
    filter.cargoPrice !== '' &&
    s.cargoPrice !== filter.cargoPrice
  ) {
    return false;
  }
  return true;
}

/** Effective pool weight for an item under the current raid filter. */
export function itemPoolWeight(
  item: MerchantItem,
  filter: RaidFilter,
  profileId?: number,
): number {
  const matched = item.sources.filter((s) => sourceMatches(s, filter, profileId));
  if (matched.length === 0) {
    // No cargo/profile constraint matched — treat as absent when filters set.
    if (
      profileId != null ||
      filter.cargoType ||
      filter.cargoPriceBucket ||
      (filter.cargoPrice !== undefined && filter.cargoPrice !== '')
    ) {
      return 0;
    }
    return 1;
  }
  const sum = matched.reduce((a, s) => a + (s.weight != null && s.weight > 0 ? s.weight : 1), 0);
  return sum > 0 ? sum : matched.length;
}

export function itemPassesRaidFilter(
  item: MerchantItem,
  filter: RaidFilter,
  profileId?: number,
): boolean {
  const sizes = activeSizes(filter);
  if (sizes && !sizes.includes(item.size)) return false;
  return itemPoolWeight(item, filter, profileId) > 0;
}

/**
 * Score items within a sound group using pool weights when available.
 * Falls back to equal split (legacy) when all weights are equal/absent.
 * Wrong size → 0% / sizeExcluded.
 */
export function scoreWithinRaidFilter(
  items: MerchantItem[],
  filter: RaidFilter,
  mapModes: MapModeOption[] = [],
): WeightedScoredItem[] {
  const profileId = resolveProfileId(filter, mapModes);
  const sizes = activeSizes(filter);
  const sizeOk = (it: MerchantItem) => !sizes || sizes.includes(it.size);

  const survivors = items.filter(
    (it) => sizeOk(it) && itemPoolWeight(it, filter, profileId) > 0,
  );

  // Size-only pass for exclusion flag; cargo miss → also excluded from %.
  const weights = survivors.map((it) => itemPoolWeight(it, filter, profileId));
  const total = weights.reduce((a, b) => a + b, 0);

  const pctById = new Map<number, number>();
  if (survivors.length > 0 && total > 0) {
    const raw = survivors.map((it, i) => ({
      id: it.id,
      pct: (weights[i] / total) * 100,
    }));
    // Round to 1 decimal; fix drift on largest.
    const rounded = raw.map((r) => ({
      id: r.id,
      pct: Math.round(r.pct * 10) / 10,
    }));
    const drift =
      Math.round((100 - rounded.reduce((a, r) => a + r.pct, 0)) * 10) / 10;
    if (drift !== 0 && rounded.length > 0) {
      let maxIdx = 0;
      for (let i = 1; i < rounded.length; i++) {
        if (rounded[i].pct > rounded[maxIdx].pct) maxIdx = i;
      }
      rounded[maxIdx] = {
        ...rounded[maxIdx],
        pct: Math.round((rounded[maxIdx].pct + drift) * 10) / 10,
      };
    }
    for (const r of rounded) pctById.set(r.id, r.pct);
  }

  return items.map((item) => {
    const w = itemPoolWeight(item, filter, profileId);
    const sizeExcluded = !sizeOk(item) || w <= 0;
    return {
      ...item,
      displayPct: sizeExcluded ? 0 : (pctById.get(item.id) ?? 0),
      sizeExcluded,
      poolWeight: w,
    };
  });
}

/** Red / Mythic chance from weighted scored items (survivors only). */
export function weightedRedChanceFromScored(scored: WeightedScoredItem[]): number {
  const live = scored.filter((s) => !s.sizeExcluded && s.displayPct > 0);
  if (live.length === 0) return 0;
  if (live.length === 1) return live[0].rarity >= 6 ? 100 : 0;
  let red = 0;
  for (const s of live) {
    if (s.rarity >= 6) red += s.displayPct;
  }
  return Math.round(red * 10) / 10;
}

export function computeEvSummary(
  scored: WeightedScoredItem[],
  cargoPrice: number | '' | undefined,
): EvSummary {
  const live = scored.filter((s) => !s.sizeExcluded && s.displayPct > 0);
  let expectedValue = 0;
  let profitMass = 0;
  const cost =
    cargoPrice !== undefined && cargoPrice !== '' && cargoPrice > 0
      ? cargoPrice
      : 0;

  for (const s of live) {
    const p = s.displayPct / 100;
    expectedValue += p * s.contactPrice;
    if (cost > 0 && s.contactPrice > cost) profitMass += s.displayPct;
  }
  expectedValue = Math.round(expectedValue);

  return {
    expectedValue,
    cargoPrice: cost,
    paybackPercent:
      cost > 0 ? Math.round((expectedValue / cost) * 1000) / 10 : null,
    profitChancePercent: cost > 0 ? Math.round(profitMass * 10) / 10 : null,
  };
}

/**
 * Size-constrained sound fallback: if the top match has no items in the
 * selected size(s), promote the best runner-up that does.
 */
export function applySizeConstrainedFallback(
  matches: MatchResult[],
  allItems: MerchantItem[],
  sizes: string[],
): MatchResult[] {
  if (!matches.length || !sizes.length) return matches;
  const fits = (soundId: number) =>
    allItems.some((it) => it.soundId === soundId && sizes.includes(it.size));

  const best = matches[0];
  if (fits(best.soundId)) return matches;

  const alt = matches.find((m) => fits(m.soundId));
  if (!alt) return matches;
  return [alt, ...matches.filter((m) => m.soundId !== alt.soundId)];
}

export function formatKoen(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** One explorer cargo box (item group) baked into merchantData.pools. */
export type RaidPoolBox = {
  id: number;
  profileId: number;
  itemGroup: number;
  cargoTypeId?: number;
  cargoType: string;
  cargoPrice: number;
  /** Slot weight among all boxes in this profile (sums ≈ groupWeightTotal). */
  weight: number;
  /** Sum of item weights inside this box (denominator for item %). */
  weightTotal: number;
  items: { id: number; weight: number }[];
};

export type RaidProfileMeta = {
  id: number;
  label: string;
  groupWeightTotal: number;
};

/** Round to 1 decimal (same drift style as scoreWithinRaidFilter). */
export function roundPct1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function poolsForProfile(
  pools: RaidPoolBox[],
  profileId: number,
): RaidPoolBox[] {
  return pools.filter((p) => p.profileId === profileId);
}

/** Box share of the full profile merchant table. */
export function boxProfilePct(
  box: RaidPoolBox,
  groupWeightTotal: number,
): number {
  if (groupWeightTotal <= 0) return 0;
  return roundPct1((box.weight / groupWeightTotal) * 100);
}

/** Item share inside its cargo box. */
export function itemInBoxPct(
  itemWeight: number,
  box: RaidPoolBox,
): number {
  const denom =
    box.weightTotal > 0
      ? box.weightTotal
      : box.items.reduce((a, i) => a + (i.weight > 0 ? i.weight : 0), 0);
  if (denom <= 0) return 0;
  return roundPct1((itemWeight / denom) * 100);
}

/**
 * Absolute draw chance for an item from a box:
 * (boxWeight / profileTotal) × (itemWeight / boxItemTotal).
 */
export function itemAbsolutePct(
  itemWeight: number,
  box: RaidPoolBox,
  groupWeightTotal: number,
): number {
  if (groupWeightTotal <= 0) return 0;
  const denom =
    box.weightTotal > 0
      ? box.weightTotal
      : box.items.reduce((a, i) => a + (i.weight > 0 ? i.weight : 0), 0);
  if (denom <= 0 || box.weight <= 0) return 0;
  return roundPct1(((box.weight / groupWeightTotal) * (itemWeight / denom)) * 100);
}

/** Unique maps from mapModes, sorted. */
export function uniqueMapNames(mapModes: MapModeOption[]): string[] {
  return [...new Set(mapModes.map((m) => m.mapName))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Modes available for a map name. */
export function modesForMap(
  mapModes: MapModeOption[],
  mapName: string,
): string[] {
  return [
    ...new Set(
      mapModes.filter((m) => m.mapName === mapName).map((m) => m.mode),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function findMapMode(
  mapModes: MapModeOption[],
  mapName: string,
  mode: string,
): MapModeOption | undefined {
  return mapModes.find((m) => m.mapName === mapName && m.mode === mode);
}
