// Robin, a made-up person: the public page's record (site/media/robin.json), for lab pages that should
// show what the site shows. Nothing in it is anyone's real work.
import { mindFrom, type Mind, type RawDay, type RawMessage } from "./data";

export interface RobinFile {
  dayFields: string[]; days: unknown[][]; projects: string[]; families: string[];
  rows: [string, number, number, number, number, string, (number | null)?][];   // day, hour, project, family, words, text, all Claude wrote for the message (outAll)
}

/** The file's compact rows as the app's messages and days. */
export function unpackRobin(r: RobinFile): { messages: RawMessage[]; days: RawDay[] } {
  const days = r.days.map(row => Object.fromEntries(r.dayFields.map((k, i) => [k, row[i]])) as unknown as RawDay);
  const messages = r.rows.map(([day, hour, p, f, words, text, outAll], i) => ({
    id: `robin-${i}`, project: r.projects[p], day, hour, kind: "prompt", words, family: f < 0 ? null : r.families[f], text, outAll,
  }));
  return { messages, days };
}

export async function robinMind(url: string): Promise<Mind> {
  const { messages, days } = unpackRobin(await fetch(url).then(r => r.json()));
  return mindFrom(messages, days);
}
