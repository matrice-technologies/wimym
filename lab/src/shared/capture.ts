// Capturing a piece: a PNG still with its caption, or a short webm loop. No CSS, no side effects,
// so the hero component can use it too.
import type { Theme } from "./palette";
import type { Piece } from "./piece";

/** The canvas as it is now, with the caption set in the page's type, saved as a PNG. */
/** t: the piece's current time, so the still is the frame on screen. */
export function savePNG(piece: Piece, theme: Theme, name: string, t: number, withCaption = true) {
  piece.frame(t, 0);  // draw now so the WebGL buffer is fresh
  const src = piece.canvas;
  const out = document.createElement("canvas");
  out.width = src.width; out.height = src.height;
  const g = out.getContext("2d")!;
  g.fillStyle = theme.ground; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0);
  const c = piece.caption(), s = out.width / Math.max(1, src.clientWidth);
  g.fillStyle = theme.muted;
  g.font = `500 ${12 * s}px "Instrument Sans Variable", system-ui`;
  g.textBaseline = "middle";
  for (const l of piece.labels?.() ?? []) { g.globalAlpha = l.alpha ?? 1; g.textAlign = l.align ?? "center"; g.fillText(l.text, l.x * s, l.y * s); }
  g.globalAlpha = 1;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  if (!withCaption) return download(out, name);
  const pad = 40 * s;
  g.fillStyle = theme.ink;
  g.font = `600 ${26 * s}px "Bricolage Grotesque Variable", system-ui`;
  g.fillText(c.line, pad, out.height - pad - 26 * s);
  g.fillStyle = theme.muted;
  g.font = `400 ${15 * s}px "Instrument Sans Variable", system-ui`;
  g.fillText(c.sub, pad, out.height - pad);
  g.textAlign = "right";
  g.fillText("Where is your mind?", out.width - pad, out.height - pad);
  download(out, name);
}

function download(out: HTMLCanvasElement, name: string) {
  const a = document.createElement("a");
  a.download = `wimym-${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}.png`;
  a.href = out.toDataURL("image/png");
  a.click();
}

/** Six seconds of the canvas as a webm, for a loop to share. */
export function recordLoop(piece: Piece, name: string, seconds = 6) {
  const stream = piece.canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 12e6 });
  const parts: Blob[] = [];
  rec.ondataavailable = e => parts.push(e.data);
  rec.onstop = () => {
    const a = document.createElement("a");
    a.download = `wimym-${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}.webm`;
    a.href = URL.createObjectURL(new Blob(parts, { type: "video/webm" }));
    a.click();
  };
  rec.start();
  document.body.classList.add("recording");
  setTimeout(() => { rec.stop(); document.body.classList.remove("recording"); }, seconds * 1000);
}
