// The app's seven families of what a message asks for, one colour each, in both themes
// (the same values as app/src/styles.css, so a piece dropped into the app agrees with it).

export const FAM_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#11a811", "#9085e9"];
export const FAM_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
export const FAM_NAMES = ["Ask", "Steer", "Make", "Approve", "Run", "Ship", "Think"];

export interface Theme {
  dark: boolean;
  ground: string;    // page behind the canvas
  deep: string;      // the far edge of the ground, for vignettes
  ink: string;
  muted: string;
  fam: string[];
  plain: string;     // a message without a label
  ember: string;     // late hours
  now: string;       // this week
}

export const DARK: Theme = {
  dark: true, ground: "#080b14", deep: "#03050a", ink: "#e9edf5", muted: "#7d8698",
  fam: FAM_DARK, plain: "#b9c6e4", ember: "#ff7a45", now: "#fff3d6",
};
export const LIGHT: Theme = {
  dark: false, ground: "#eef0f4", deep: "#dfe3ec", ink: "#121725", muted: "#6b7386",
  fam: FAM_LIGHT, plain: "#3d4559", ember: "#d8431c", now: "#121725",
};

export function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
