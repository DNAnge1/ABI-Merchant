import type { SelftestReport, SelftestRow } from '../utils/browserSelftest';

export function SelftestPanel(props: {
  open: boolean;
  running: boolean;
  progress: { done: number; total: number } | null;
  report: SelftestReport | null;
  onRun: () => void;
  onClose: () => void;
}) {
  if (!props.open) return null;
  const { report, running, progress } = props;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-4 pt-16 overflow-y-auto">
      <section className="w-full max-w-2xl rounded border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="m-0 text-sm font-semibold text-[var(--text)]">
              AnalyserNode self-test
            </h2>
            <p className="m-0 mt-0.5 text-[11px] text-[var(--muted)]">
              Decode all 38 pickup OGGs and score PCM live300 (onset + ~300ms linear FFT)
              at the browser sample rate — same window math as fingerprints / offline
              self-test.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={running}
              onClick={props.onRun}
              className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412] disabled:opacity-50"
            >
              {running ? 'Running…' : report ? 'Re-run' : 'Run self-test'}
            </button>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded px-3 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)]"
            >
              Close
            </button>
          </div>
        </header>

        <div className="px-4 py-3 space-y-3">
          {running && progress && (
            <p className="m-0 text-xs text-[var(--muted)]">
              Scoring pickup {progress.done}/{progress.total}…
            </p>
          )}

          {report && (
            <>
              <div
                className={[
                  'rounded border px-3 py-2 text-sm font-semibold tabular-nums',
                  report.ok
                    ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]'
                    : 'border-[#5c2a33] bg-[#3a1f24]/50 text-[#ffb4bc]',
                ].join(' ')}
              >
                {report.ok ? 'PASS' : 'FAIL'} — {report.passed}/{report.total} (
                {report.passRate}%) · {report.sampleRate} Hz · fftSize {report.fftSize}
              </div>

              <div className="max-h-[50vh] overflow-auto rounded border border-[var(--border)]">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-[var(--bg-panel)] text-[var(--muted)]">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">#</th>
                      <th className="px-2 py-1.5 font-medium">Result</th>
                      <th className="px-2 py-1.5 font-medium">Top</th>
                      <th className="px-2 py-1.5 font-medium">Conf</th>
                      <th className="px-2 py-1.5 font-medium">Expected</th>
                      <th className="px-2 py-1.5 font-medium">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <Row key={row.soundId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!report && !running && (
            <p className="m-0 text-xs text-[var(--muted)]">
              Click Run to score every pickup reference through the live analyser path
              (fftSize 4096 when sampleRate &gt; 30 kHz).
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ row }: { row: SelftestRow }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="px-2 py-1 tabular-nums">{row.soundId}</td>
      <td
        className={[
          'px-2 py-1 font-semibold',
          row.pass ? 'text-[var(--ok)]' : 'text-[#ffb4bc]',
        ].join(' ')}
      >
        {row.error ? 'ERR' : row.pass ? 'OK' : 'MISS'}
      </td>
      <td className="px-2 py-1 tabular-nums">
        {row.error ? '—' : `#${row.topId ?? '—'}`}
      </td>
      <td className="px-2 py-1 tabular-nums">
        {row.error ? '—' : `${row.topConfidence}%`}
      </td>
      <td className="px-2 py-1 tabular-nums text-[var(--muted)]">
        {row.error ? row.error.slice(0, 40) : `${row.expectedConfidence}%`}
      </td>
      <td className="px-2 py-1 text-[var(--muted)] truncate max-w-[12rem]" title={row.file}>
        {row.file.split('/').pop()}
      </td>
    </tr>
  );
}
