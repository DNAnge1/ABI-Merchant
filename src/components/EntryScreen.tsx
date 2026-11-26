import { EntryTrustFaq, EntryTrustStrip } from './EntryTrustFaq';
import { WipAccuracyBanner } from './WipAccuracyBanner';

export function EntryScreen(props: {
  onAutomatic: () => void;
  onManual: () => void;
  onTrouble: () => void;
  onOpenSuggestions?: () => void;
  onOpenStats?: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top-pinned so the disclaimer stays above the fold without crowding Auto/Manual */}
      <div className="w-full max-w-lg mx-auto shrink-0 px-1 pt-1 pb-3">
        <WipAccuracyBanner
          prominent
          onOpenSuggestions={props.onOpenSuggestions}
          onOpenStats={props.onOpenStats}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-10 pt-2">
        <div className="w-full max-w-md flex flex-col items-center gap-7 text-center">
          <div className="space-y-2">
            <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
              ABI Merchant
            </p>
            <h2 className="m-0 text-[28px] font-medium tracking-tight text-[var(--text)]">
              Field Merchant Scanner
            </h2>
            <p className="m-0 text-sm text-[var(--muted)] leading-relaxed">
              Share game audio, match cargo sounds, and read Red Chance / EV — free and local in your
              browser.
            </p>
          </div>

          <button
            type="button"
            onClick={props.onAutomatic}
            className="w-[220px] h-[220px] rounded-full border-[1.5px] border-[var(--accent)] bg-[var(--bg-elevated)] flex flex-col items-center justify-center gap-2 hover:bg-[var(--accent-dim)]/20 transition-colors"
          >
            <span className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
              Start Scan
            </span>
            <span className="text-[12px] text-[var(--muted)] max-w-[140px] leading-snug">
              Wizard → listen at the merchant
            </span>
          </button>

          {/* Trust strip near primary CTA — Entry only */}
          <div className="w-full -mt-2">
            <EntryTrustStrip />
          </div>

          <button
            type="button"
            onClick={props.onManual}
            className="bg-transparent border-none text-[var(--accent)] text-sm font-medium px-3 py-2 hover:underline"
          >
            Manual Mode — filters + sound board
          </button>

          <button
            type="button"
            onClick={props.onTrouble}
            className="bg-transparent border-none text-[var(--muted)] text-xs underline underline-offset-2 hover:text-[var(--text)]"
          >
            Need help? Troubleshooting
          </button>

          {/* FAQ button → modal (keeps Entry short); not on the live scan HUD */}
          <EntryTrustFaq />
        </div>
      </div>
    </div>
  );
}
