/**
 * Pop-out mini overlay: prefer documentPictureInPicture, else return null
 * so the UI can show a compact floating fallback panel.
 */

export type PipHandle = {
  window: Window;
  close: () => void;
};

export function supportsDocumentPiP(): boolean {
  return typeof document !== 'undefined' && 'documentPictureInPicture' in window;
}

export async function openDocumentPiP(opts?: {
  width?: number;
  height?: number;
}): Promise<PipHandle | null> {
  if (!supportsDocumentPiP()) return null;
  try {
    // @ts-expect-error experimental API
    const pipWindow: Window = await window.documentPictureInPicture.requestWindow({
      width: opts?.width ?? 360,
      height: opts?.height ?? 220,
    });
    return {
      window: pipWindow,
      close: () => {
        try {
          pipWindow.close();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}

export function renderPipContent(
  pipWindow: Window,
  data: { group: number; confidence: number; redPct: number; status: string },
) {
  const doc = pipWindow.document;
  doc.head.innerHTML = `<style>
    body{margin:0;font:12px/1.4 system-ui,sans-serif;background:#0b0e12;color:#e8edf5;padding:12px}
    .red{color:#ff3b4a;font-size:28px;font-weight:700}
    .muted{color:#8b97a8}
    .ok{color:#3dd6c6}
  </style>`;
  doc.body.innerHTML = `
    <div class="muted">${data.status}</div>
    <div style="margin-top:8px">Group <strong class="ok">#${data.group}</strong>
      · ${data.confidence}% audio</div>
    <div class="red" style="margin-top:6px">${data.redPct}%</div>
    <div class="muted">Red / Mythic chance</div>
  `;
}
