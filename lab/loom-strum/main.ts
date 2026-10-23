import robinUrl from "../../site/media/robin.json?url";
import { loomStrum } from "../src/pieces/loom-strum";
import { mindFrom } from "../src/shared/data";
import { robinMind } from "../src/shared/robin";
import { mountLab } from "../src/shared/stage";
// Robin, the public page's made-up person, by default: Robin's file has no sessions, so they are guessed
// from pauses. ?engine reads the lab's engine (/api, port 8994 or WIMYM_API): the person's own record, with
// /api/messages for its session ids (points carry none). It stays in their browser.
const engine = new URLSearchParams(location.search).has("engine");
const get = (u: string) => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
const own = async () => { const [core, msgs] = await Promise.all([get("/api/core"), get("/api/messages")]); return mindFrom(msgs.messages, core.days); };
mountLab("Loom, strummed", loomStrum, engine ? { load: own, badge: "Your own record" } : { load: () => robinMind(robinUrl), badge: "Robin, a made-up person" });
