/**
 * Map / Mode explainer — why pool weights change Red Chance & EV,
 * plus interactive inspection of static explorer raid pools.
 * Opened from Entry / footer; keep out of Catch HUD chrome.
 */

import { useMemo, useState } from 'react';
import type { MerchantItem } from '../utils/audioMatcher';
import { ItemThumb } from './ItemThumb';
import { rarityHue, rarityHueTextClass } from '../utils/itemDisplay';
import {
  boxProfilePct,
  computeEvSummary,
  findMapMode,
  formatKoen,
  itemAbsolutePct,
  itemInBoxPct,
  modesForMap,
  poolsForProfile,
  roundPct1,
  scoreWithinRaidFilter,
  uniqueMapNames,
  weightedRedChanceFromScored,
  type MapModeOption,
  type RaidPoolBox,
  type RaidProfileMeta,
} from '../utils/raidPools';

function rarityLabel(rarity: number): string {
  if (rarity >= 6) return 'Mythic';
  if (rarity >= 5) return 'Legendary';
  if (rarity >= 4) return 'Epic';
  if (rarity >= 3) return 'Rare';
  return 'Common';
}

export function MapModePoolsPage(props: {
  mapModes: MapModeOption[];
  pools: RaidPoolBox[];
  profiles: RaidProfileMeta[];
  items: MerchantItem[];
  onBack: () => void;
  /** Optional: jump to Start Scan with this map/mode preselected. */
  onUseInScan?: (mapModeId: string) => void;
}) {
  const maps = useMemo(() => uniqueMapNames(props.mapModes), [props.mapModes]);
  const [mapName, setMapName] = useState(maps[0] ?? '');
  const modes = useMemo(
    () => (mapName ? modesForMap(props.mapModes, mapName) : []),
    [props.mapModes, mapName],
  );
  const [mode, setMode] = useState(modes[0] ?? '');
  const [cargoFilter, setCargoFilter] = useState('');
  const [openBoxId, setOpenBoxId] = useState<number | null>(null);
  const [showHow, setShowHow] = useState(false);

  // Keep mode valid when map changes.
  const activeMode = modes.includes(mode) ? mode : (modes[0] ?? '');
  const mapMode = findMapMode(props.mapModes, mapName, activeMode);
  const profileId = mapMode?.profileId;
  const profile = props.profiles.find((p) => p.id === profileId);

  const profileBoxes = useMemo(() => {
    if (profileId == null) return [];
    return poolsForProfile(props.pools, profileId).slice().sort((a, b) => {
      const ct = a.cargoType.localeCompare(b.cargoType);
      if (ct !== 0) return ct;
      if (a.cargoPrice !== b.cargoPrice) return a.cargoPrice - b.cargoPrice;
      return a.itemGroup - b.itemGroup;
    });
  }, [props.pools, profileId]);

  const groupTotal =
    profile?.groupWeightTotal ??
    profileBoxes.reduce((a, b) => a + b.weight, 0);

  const filteredBoxes = useMemo(() => {
    if (!cargoFilter) return profileBoxes;
    return profileBoxes.filter((b) => b.cargoType === cargoFilter);
  }, [profileBoxes, cargoFilter]);

  const cargoOptions = useMemo(() => {
    const set = new Set(profileBoxes.map((b) => b.cargoType));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [profileBoxes]);

  const itemsById = useMemo(() => {
    const m = new Map<number, MerchantItem>();
    for (const it of props.items) m.set(it.id, it);
    return m;
  }, [props.items]);

  /** Red / EV for the selected map/mode across all items in that profile (no sound filter). */
  const profileSummary = useMemo(() => {
    if (profileId == null || !mapMode) return null;
    const scored = scoreWithinRaidFilter(
      props.items,
      { mapModeId: mapMode.id },
      props.mapModes,
    );
    const live = scored.filter((s) => !s.sizeExcluded && s.displayPct > 0);
    const red = weightedRedChanceFromScored(scored);
    // Sample EV at a common Mystery Cargo price if present in this profile.
    const mysteryBoxes = profileBoxes.filter((b) =>
      /Mystery Cargo/i.test(b.cargoType),
    );
    const sampleBox = mysteryBoxes
      .slice()
      .sort((a, b) => a.cargoPrice - b.cargoPrice)[0];
    const samplePrice = sampleBox?.cargoPrice;
    const cargoScored =
      sampleBox != null
        ? scoreWithinRaidFilter(
            props.items,
            {
              mapModeId: mapMode.id,
              cargoType: sampleBox.cargoType,
              cargoPrice: sampleBox.cargoPrice,
            },
            props.mapModes,
          )
        : scored;
    const ev = computeEvSummary(
      sampleBox != null ? cargoScored : scored,
      samplePrice ?? '',
    );
    return {
      itemCount: live.length,
      red,
      samplePrice,
      ev,
      boxCount: profileBoxes.length,
    };
  }, [profileId, mapMode, props.items, props.mapModes, profileBoxes]);

  return (
    <div className="max-w-[820px] mx-auto flex flex-col gap-4" data-map-mode-pools-page>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-2xl font-medium tracking-tight">Map / Mode · Pools</h2>
          <p className="m-0 mt-1 text-[13px] text-[var(--muted)]">
            Why raid map &amp; mode change Red Chance and EV — inspect the static loot pools.
          </p>
        </div>
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
        >
          ← Back
        </button>
      </div>

      {/* Giant overview */}
      <section className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)]/15 px-4 py-4 space-y-3">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
          Why Map / Mode matters
        </h3>
        <p className="m-0 text-[14px] leading-relaxed text-[var(--text)]">
          Each raid map + difficulty (Normal, Lockdown, Forbidden, Infected…) uses a different{' '}
          <strong className="font-semibold text-[var(--accent)]">loot pool profile</strong>. The
          Field Merchant doesn’t roll every item equally — explorer data assigns{' '}
          <strong className="font-semibold">weights</strong> to cargo boxes and to items inside
          those boxes.
        </p>
        <ul className="m-0 pl-4 text-[13px] leading-relaxed text-[var(--muted)] space-y-1.5">
          <li>
            <span className="text-[var(--text)]">Red Chance</span> — after we lock a sound group
            (and size), remaining candidates are scored by pool weight. More weight on Mythic
            items → higher Red %. Same sound on Farm Lockdown vs Airport Forbidden can differ.
          </li>
          <li>
            <span className="text-[var(--text)]">EV / Payback</span> — expected Koen is Σ
            (probability × contact price). Heavier high-value boxes raise EV; cargo price is the
            cost basis for payback %.
          </li>
          <li>
            <span className="text-[var(--text)]">“Any map”</span> — averages across profiles (or
            equal share when weights are missing). Pick your real map/mode for honest odds.
          </li>
        </ul>
        <details
          className="rounded border border-[var(--border)] bg-[var(--bg-panel)]/80 px-3 py-2"
          open={showHow}
          onToggle={(e) => setShowHow((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-[12px] text-[var(--accent)]">
            How the math works ▾
          </summary>
          <ol className="m-0 mt-2 pl-4 text-[12px] leading-relaxed text-[var(--muted)] space-y-1">
            <li>
              Map/mode → <code className="text-[var(--text)]">profileId</code> (shared by several
              map+mode combos).
            </li>
            <li>
              Profile table = cargo boxes. Box % = box weight ÷ profile total (
              {groupTotal > 0 ? groupTotal : 'groupWeightTotal'}).
            </li>
            <li>
              Inside a box, item % = item weight ÷ box item total. Absolute draw ≈ box % × item %.
            </li>
            <li>
              On Start Scan, we only renormalize among the locked sound’s survivors (size + raid
              filter) — same weights, smaller denominator.
            </li>
          </ol>
        </details>
      </section>

      {/* Interactive picker */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]/95 px-3 py-3 space-y-3">
        <h3 className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Inspect a pool
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Map</span>
            <select
              value={mapName}
              onChange={(e) => {
                const next = e.target.value;
                setMapName(next);
                const nextModes = modesForMap(props.mapModes, next);
                setMode(nextModes[0] ?? '');
                setOpenBoxId(null);
              }}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[13px] text-[var(--text)]"
            >
              {maps.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Mode</span>
            <select
              value={activeMode}
              onChange={(e) => {
                setMode(e.target.value);
                setOpenBoxId(null);
              }}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[13px] text-[var(--text)]"
            >
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>

        {mapMode && profile && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full px-2.5 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)] tabular-nums">
              Pool {profile.id}
            </span>
            <span className="text-[var(--muted)] truncate max-w-full" title={profile.label}>
              {profile.label}
            </span>
          </div>
        )}

        {profileSummary && mapMode && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatChip label="Boxes" value={String(profileSummary.boxCount)} />
            <StatChip label="Weighted items" value={String(profileSummary.itemCount)} />
            <StatChip
              label="Red mass"
              value={`${profileSummary.red}%`}
              accent="mythic"
              title="Share of catalog weight on Mythic (≥6) under this profile (all cargo)"
            />
            <StatChip
              label={
                profileSummary.samplePrice != null
                  ? `EV @ ${formatKoen(profileSummary.samplePrice)}`
                  : 'EV'
              }
              value={
                profileSummary.samplePrice != null
                  ? formatKoen(profileSummary.ev.expectedValue)
                  : '—'
              }
              title="Expected contact value for a sample Mystery Cargo price on this profile"
            />
          </div>
        )}

        {mapMode && props.onUseInScan && (
          <button
            type="button"
            onClick={() => props.onUseInScan?.(mapMode.id)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold bg-[var(--accent)] text-[#041412]"
          >
            Use {mapMode.name} on Start Scan →
          </button>
        )}
      </section>

      {/* Pool breakdown */}
      {profileId != null && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              Cargo boxes · weights &amp; %
            </h3>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              Filter
              <select
                value={cargoFilter}
                onChange={(e) => {
                  setCargoFilter(e.target.value);
                  setOpenBoxId(null);
                }}
                className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--text)]"
              >
                <option value="">All cargo types</option>
                {cargoOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="m-0 text-[11px] text-[var(--muted)] leading-snug">
            Numbers from <code className="text-[var(--text)]">merchantData.json</code> pools —
            not invented. Box % of profile · item % inside box · absolute ≈ product.
          </p>

          <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
            {filteredBoxes.map((box) => (
              <PoolBoxRow
                key={box.id}
                box={box}
                groupTotal={groupTotal}
                itemsById={itemsById}
                open={openBoxId === box.id}
                onToggle={() =>
                  setOpenBoxId((prev) => (prev === box.id ? null : box.id))
                }
              />
            ))}
          </ul>

          {filteredBoxes.length === 0 && (
            <p className="m-0 text-[12px] text-[var(--muted)] text-center py-6">
              No boxes for this filter.
            </p>
          )}
        </section>
      )}

      <p className="m-0 text-[10px] text-[var(--muted)] leading-snug">
        Catalog courtesy of the public explorer at abibuilder.com/merchant. Independent fan
        companion — not affiliated with Morefun Studios or Tencent Games.
      </p>
    </div>
  );
}

function StatChip(props: {
  label: string;
  value: string;
  accent?: 'mythic' | 'accent';
  title?: string;
}) {
  const valueClass =
    props.accent === 'mythic'
      ? 'text-[var(--mythic)]'
      : props.accent === 'accent'
        ? 'text-[var(--accent)]'
        : 'text-[var(--text)]';
  return (
    <div
      className="rounded border border-[var(--border)] bg-[var(--bg)]/60 px-2.5 py-2"
      title={props.title}
    >
      <div className="text-[9px] uppercase tracking-wide text-[var(--muted)]">{props.label}</div>
      <div className={`mt-0.5 text-[15px] font-semibold tabular-nums ${valueClass}`}>
        {props.value}
      </div>
    </div>
  );
}

function PoolBoxRow(props: {
  box: RaidPoolBox;
  groupTotal: number;
  itemsById: Map<number, MerchantItem>;
  open: boolean;
  onToggle: () => void;
}) {
  const { box, groupTotal } = props;
  const boxPct = boxProfilePct(box, groupTotal);
  const itemRows = box.items
    .map((row) => {
      const item = props.itemsById.get(row.id);
      return {
        row,
        item,
        inBox: itemInBoxPct(row.weight, box),
        abs: itemAbsolutePct(row.weight, box, groupTotal),
      };
    })
    .sort((a, b) => b.row.weight - a.row.weight);

  const redInBox = itemRows
    .filter((r) => r.item && r.item.rarity >= 6)
    .reduce((a, r) => a + r.inBox, 0);

  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]/80 overflow-hidden">
      <button
        type="button"
        onClick={props.onToggle}
        className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-[var(--accent-dim)]/10"
      >
        <span className="text-[13px] font-medium text-[var(--text)] min-w-0 flex-1">
          {box.cargoType}{' '}
          <span className="text-[var(--muted)] font-normal">· {formatKoen(box.cargoPrice)}</span>
        </span>
        <span className="text-[10px] tabular-nums text-[var(--muted)]">
          Group {box.itemGroup} · {box.items.length} items
        </span>
        <span className="text-[12px] font-semibold tabular-nums text-[var(--accent)]">
          w {box.weight} · {boxPct}%
        </span>
        {redInBox > 0 && (
          <span className="text-[11px] font-semibold tabular-nums text-[var(--mythic)]">
            Red {roundPct1(redInBox)}% in box
          </span>
        )}
        <span className="text-[10px] text-[var(--muted)]">{props.open ? '▴' : '▾'}</span>
      </button>

      {props.open && (
        <div className="border-t border-[var(--border)] px-2 py-2 space-y-1">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-1 pb-1 text-[9px] uppercase tracking-wide text-[var(--muted)]">
            <span>Item</span>
            <span className="text-right">Weight</span>
            <span className="text-right">In box</span>
            <span className="text-right">Abs</span>
          </div>
          {itemRows.map(({ row, item, inBox, abs }) => {
            const hue = item ? rarityHue(item) : 'blue';
            return (
              <div
                key={row.id}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-center rounded px-1 py-1 hover:bg-[var(--bg)]/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {item ? (
                    <ItemThumb item={item} size="sm" />
                  ) : (
                    <div className="h-9 w-9 rounded bg-black/30 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[12px] text-[var(--text)] truncate">
                      {item?.name ?? `Item ${row.id}`}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {item ? (
                        <>
                          <span className={rarityHueTextClass(hue)}>
                            {rarityLabel(item.rarity)}
                          </span>
                          {' · '}
                          {item.size}
                          {' · '}
                          Group #{item.soundId}
                          {' · '}
                          {formatKoen(item.contactPrice)}
                        </>
                      ) : (
                        'Not in local catalog'
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] tabular-nums text-[var(--muted)] text-right w-12">
                  {row.weight}
                </span>
                <span className="text-[11px] tabular-nums text-[var(--text)] text-right w-12">
                  {inBox}%
                </span>
                <span className="text-[11px] tabular-nums text-[var(--accent)] text-right w-12">
                  {abs}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}
