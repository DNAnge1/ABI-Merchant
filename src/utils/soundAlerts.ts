/** Lightweight Web Audio chimes + optional TTS for single-monitor QoL. */

let sharedCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext();
  return sharedCtx;
}

async function beep(freq: number, durationMs: number, gain = 0.08) {
  const c = ctx();
  if (c.state === 'suspended') await c.resume();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(c.destination);
  const t0 = c.currentTime;
  osc.start(t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.stop(t0 + durationMs / 1000 + 0.02);
}

export async function playHighAlertChime() {
  await beep(880, 90, 0.09);
  await new Promise((r) => setTimeout(r, 70));
  await beep(1320, 140, 0.1);
}

export async function playLowAlertTone() {
  await beep(220, 220, 0.07);
}

export function speakAlert(text: string) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 1;
  u.volume = 0.9;
  speechSynthesis.speak(u);
}

export async function alertForMatch(opts: {
  soundId: number;
  redPct: number;
  enabled: boolean;
  useTts: boolean;
}) {
  if (!opts.enabled) return;
  if (opts.redPct > 0) {
    await playHighAlertChime();
    if (opts.useTts) speakAlert(`Group ${opts.soundId}, Red Possible`);
  } else {
    await playLowAlertTone();
  }
}
