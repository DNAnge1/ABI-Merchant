import { detectBrowser, browserFixSteps } from '../utils/browserAudio';
import { WipAccuracyBanner } from './WipAccuracyBanner';

export type TroubleSection =
  | 'overview'
  | 'windows'
  | 'errors'
  | 'browsers'
  | 'tools';

const KNOWN_ERRORS: {
  id: string;
  title: string;
  summary: string;
  fixId: TroubleSection;
}[] = [
  {
    id: 'not-readable',
    title: 'NotReadableError / Could not start audio source',
    summary:
      'Common with G560 and exclusive mode. Use Mic / loopback (VB-Cable / Stereo Mix). Chrome Tab will not capture desktop ABI audio.',
    fixId: 'windows',
  },
  {
    id: 'exclusive',
    title: 'Exclusive mode blocking capture',
    summary:
      'Site microphone Allow is not the same as disabling exclusive control. Follow the Windows steps below.',
    fixId: 'windows',
  },
  {
    id: 'silence',
    title: 'Silence after a good share',
    summary:
      'Normal until you are at Field Merchant dragging cargo. Meter should spike on cargo moves.',
    fixId: 'tools',
  },
  {
    id: 'wrong-browser',
    title: 'Firefox / Safari Automatic Mode',
    summary:
      'These browsers cannot reliably share game audio here. Use Chrome or Edge with mic/loopback, or Manual Mode.',
    fixId: 'browsers',
  },
];

export function TroubleshootingPage(props: {
  section: TroubleSection;
  capturing: boolean;
  onSection: (s: TroubleSection) => void;
  onBack: () => void;
  onVerify: () => void;
  onSelftest: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onMicFallback: () => void;
  onRetest?: () => void;
  onStartOver?: () => void;
}) {
  const browser = detectBrowser();
  const tabs: { id: TroubleSection; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'windows', label: 'Windows steps' },
    { id: 'errors', label: 'Known errors' },
    { id: 'browsers', label: 'Browsers' },
    { id: 'tools', label: 'Verify / Self-test' },
  ];

  return (
    <div className="max-w-[820px] mx-auto flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="m-0 text-2xl font-medium tracking-tight">Troubleshooting</h2>
          <p className="m-0 text-sm text-[var(--muted)]">
            One-stop: Windows fixes, known errors, browsers, Verify Audio & Self-test.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.onRetest && (
            <button
              type="button"
              onClick={props.onRetest}
              className="rounded-full px-3 py-1 text-[12px] font-semibold bg-[var(--accent)] text-[#041412]"
            >
              Retest
            </button>
          )}
          {props.onStartOver && (
            <button
              type="button"
              onClick={props.onStartOver}
              className="rounded-full px-3 py-1 text-[12px] font-medium border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--muted)] hover:text-[var(--text)]"
            >
              Start over
            </button>
          )}
          <button
            type="button"
            onClick={props.onBack}
            className="rounded-full px-3 py-1 text-[12px] font-medium border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            ← Back
          </button>
        </div>
      </div>

      <WipAccuracyBanner />

      <div className="rounded-lg border border-[var(--accent)]/35 bg-[var(--accent-dim)]/15 px-3 py-2.5 text-[12px] text-[var(--text)] leading-relaxed">
        Switched headphones ↔ speakers and capture died? That often ends the audio track (G560 /
        exclusive mode). Use <strong>Retest</strong> or Mic / loopback — you should never be stuck
        without recovery.
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => props.onSection(t.id)}
            className={[
              'rounded-full px-3 py-1 text-[12px] font-medium border',
              props.section === t.id
                ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--text)]'
                : 'border-[var(--border)] bg-[var(--bg-panel)] text-[var(--muted)]',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {props.section === 'overview' && (
        <div className="space-y-3">
          <p className="m-0 text-sm text-[var(--muted)] leading-relaxed">
            Prefer Mic / loopback (VB-Cable or Stereo Mix) for desktop ABI. Chrome Tab share cannot
            hear game audio. Exclusive mode is a Windows device setting — not the site’s microphone
            Allow prompt.
          </p>
          <p className="m-0 text-xs text-[var(--muted)]">
            Detected browser: <strong className="text-[var(--text)]">{browser.label}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Primary onClick={() => props.onSection('windows')}>
              Windows exclusive-mode steps
            </Primary>
            <Outline onClick={() => props.onSection('errors')}>Known errors</Outline>
            <Outline onClick={() => props.onSection('browsers')}>Supported browsers</Outline>
          </div>
        </div>
      )}

      {props.section === 'windows' && (
        <div className="space-y-4">
          <h3 className="m-0 text-base font-medium">Disable exclusive control (Windows)</h3>
          <ol className="m-0 pl-5 text-sm leading-7 text-[var(--text)]">
            <li>
              Win+R → type <code className="code-chip">mmsys.cpl</code> → Enter
            </li>
            <li>Playback → right-click your default device → Properties → Advanced</li>
            <li>
              Uncheck “Allow applications to take exclusive control of this device” → Apply → OK
            </li>
            <li>Repeat under Recording for the default recording device</li>
          </ol>
          <h3 className="m-0 text-base font-medium">Mic / loopback (recommended for ABI)</h3>
          <Info title="VB-Audio Cable (recommended)">
            Install VB-Cable (or VoiceMeeter). Set Cable Input as Windows default playback (or route
            ABI there). In Chrome pick “CABLE Output” as the input. Chrome Tab share cannot hear
            desktop ABI.
          </Info>
          <Info title="Stereo Mix">
            mmsys.cpl → Recording → right-click empty area → Show Disabled Devices → enable Stereo
            Mix → set as Default. Pick Stereo Mix in the app.
          </Info>
          <Primary onClick={props.onMicFallback}>Open Mic / loopback picker</Primary>
        </div>
      )}

      {props.section === 'errors' && (
        <div className="space-y-2.5">
          {KNOWN_ERRORS.map((e) => (
            <div
              key={e.id}
              className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-panel)] p-3.5 space-y-1.5"
            >
              <div className="font-semibold text-sm">{e.title}</div>
              <p className="m-0 text-[13px] text-[var(--muted)] leading-snug">{e.summary}</p>
              <button
                type="button"
                onClick={() => props.onSection(e.fixId)}
                className="bg-transparent border-none text-[var(--accent)] text-xs font-semibold p-0 cursor-pointer"
              >
                Go to fix →
              </button>
            </div>
          ))}
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3.5">
            <div className="font-semibold text-sm mb-1">Steps for {browser.label}</div>
            <ul className="m-0 pl-4 text-[13px] text-[var(--muted)] space-y-1">
              {browserFixSteps(browser).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {props.section === 'browsers' && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="p-2 border-b border-[var(--border)] text-[11px] uppercase tracking-wide">
                  Browser
                </th>
                <th className="p-2 border-b border-[var(--border)] text-[11px] uppercase tracking-wide">
                  Automatic
                </th>
                <th className="p-2 border-b border-[var(--border)] text-[11px] uppercase tracking-wide">
                  Needs
                </th>
              </tr>
            </thead>
            <tbody>
              <BrowserRow
                name="Chrome"
                auto="Supported"
                needs="Mic / loopback for desktop ABI. Tab share won’t hear game audio."
              />
              <BrowserRow
                name="Edge"
                auto="Supported"
                needs="Same as Chrome — mic/loopback preferred."
              />
              <BrowserRow
                name="Brave"
                auto="Partial"
                needs="Shields Down for this site; then mic/loopback."
              />
              <BrowserRow
                name="Firefox"
                auto="Not supported"
                needs="Use Chrome/Edge, or Manual Mode."
              />
              <BrowserRow
                name="Safari"
                auto="Not supported"
                needs="Use Chrome/Edge, or Manual Mode."
              />
            </tbody>
          </table>
        </div>
      )}

      {props.section === 'tools' && (
        <div className="space-y-3.5">
          <p className="m-0 text-sm text-[var(--muted)]">
            Verify Audio checks that the browser can hear a path. Self-test runs known clips.
            Start/Stop listening matches the Auto listen control.
          </p>
          <div className="flex flex-wrap gap-2">
            <Primary onClick={props.onVerify}>Verify Audio</Primary>
            <Outline onClick={props.onSelftest}>Self-test</Outline>
            <Outline
              onClick={() =>
                props.capturing ? props.onStopListening() : props.onStartListening()
              }
            >
              {props.capturing ? 'Stop listening' : 'Start listening'}
            </Outline>
            <Outline onClick={props.onMicFallback}>Mic / loopback</Outline>
          </div>
          <Info title="After Verify">
            When you drag cargo in-raid, the meter (or Live Listening) should spike. Silence before
            Field Merchant is normal.
          </Info>
        </div>
      )}
    </div>
  );
}

function BrowserRow(props: { name: string; auto: string; needs: string }) {
  return (
    <tr>
      <td className="p-2.5 border-b border-[var(--border)] align-top">{props.name}</td>
      <td className="p-2.5 border-b border-[var(--border)] align-top">{props.auto}</td>
      <td className="p-2.5 border-b border-[var(--border)] align-top text-[var(--muted)]">
        {props.needs}
      </td>
    </tr>
  );
}

function Info(props: { title: string; children: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
      <div className="font-semibold text-[13px] mb-1">{props.title}</div>
      <p className="m-0 text-[13px] text-[var(--muted)] leading-snug">{props.children}</p>
    </div>
  );
}

function Primary(props: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-lg px-3.5 py-1.5 text-xs font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110"
    >
      {props.children}
    </button>
  );
}

function Outline(props: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-lg px-3.5 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
    >
      {props.children}
    </button>
  );
}
