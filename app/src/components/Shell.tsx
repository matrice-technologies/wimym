import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useData } from "../lib/data";
import { fmtDay, fmtN } from "../lib/format";
import Empty from "./Empty";
import { Mark } from "./Loading";
import Postcard from "./Postcard";
import { setShare, shareOn } from "../lib/share";

const P = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;
const I = {
  now: <svg {...P}><path d="M9 9.4a1 1 0 1 1 .9-1.3 2.6 2.6 0 0 1-2.4 3.4A3.9 3.9 0 0 1 4 7.4a5.2 5.2 0 0 1 5.6-4.7 6.5 6.5 0 0 1 5.8 7" strokeLinecap="round" /><circle cx="15.4" cy="11.9" r="1.3" fill="currentColor" stroke="none" /></svg>,
  week: <svg {...P}><circle cx="5" cy="6" r="2.2" /><circle cx="13" cy="6" r="2.2" /><circle cx="9" cy="13" r="2.2" /><path d="M6.6 7.6 8 11M11.4 7.6 10 11" /></svg>,
  days: <svg {...P}><rect x="2" y="3" width="14" height="13" rx="2.5" /><path d="M2 7h14M6 1.5v3M12 1.5v3" /></svg>,
  messages: <svg {...P}><path d="M3 4h12M3 8h9M3 12h12M3 16h6" /></svg>,
  practices: <svg {...P}><path d="M3 9.5 7 13.5 15 4.5" /></svg>,
  memory: <svg {...P}><path d="M9 3C5 3 2 9 2 9s3 6 7 6 7-6 7-6-3-6-7-6Z" /><circle cx="9" cy="9" r="2.4" /></svg>,
  labels: <svg {...P}><path d="M2.5 3.5h6l7 7-5 5-7-7Z" /><circle cx="6" cy="7" r="1.2" /></svg>,
};

// The pages that follow the vision first; the first, descriptive views below them, under Explore.
const NAV: [string, string, keyof typeof I][] = [
  ["/", "This week", "now"], ["/week", "The week", "week"], ["/days", "Days", "days"], ["/messages", "Messages", "messages"],
  ["/practices", "Practices", "practices"], ["/their-view", "Their view of you", "memory"], ["/labels", "Labels", "labels"],
];
const EXPLORE: [string, string][] = [["/portrait", "Portrait"], ["/lead", "How you lead"], ["/voice", "Your voice"], ["/projects", "Projects"]];
// The pages that still say something before there is a message to read: what practices are, what the labels mean.
const WITHOUT_MESSAGES = ["/practices", "/labels"];

export default function Shell() {
  const { state, core, update } = useData();
  const loc = useLocation();
  // the engine has read everything there is and found no message of yours: someone new to Claude Code
  const empty = !!core?.profile.empty && !WITHOUT_MESSAGES.includes(loc.pathname);
  useEffect(() => {
    if (!loc.hash) window.scrollTo(0, 0);
    // on a phone the rail is a row that scrolls sideways: keep the current page in view
    document.querySelector(".rail a.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [loc.pathname]);
  useEffect(() => {
    const p = loc.pathname;
    const name = p === "/" ? "This week" : p.startsWith("/days/") ? fmtDay(p.slice(6), { weekday: "long", day: "numeric", month: "long" })
      : [...NAV, ...EXPLORE.map(([to, l]) => [to, l] as const)].find(([to]) => to === p)?.[1];
    document.title = name ? `${name}, Wimym` : "Wimym";
  }, [loc.pathname]);
  const busy = !!state && state.phase !== "ready" && state.phase !== "error";
  return (
    <div className="shell">
      <nav className="rail" aria-label="Pages">
        <NavLink to="/" className="brand" aria-label="Wimym, by Matrice: this week">
          <Mark size={24} />
          <span><b>WIMYM</b><em>by Matrice</em></span>
        </NavLink>
        <div className="rail-nav">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => "nav" + (isActive ? " active" : "")}>
              {I[icon]}{label}
            </NavLink>
          ))}
          <span className="rail-h label-strip" role="presentation"><span><span className="star" aria-hidden="true">✦</span>Explore</span></span>
          {EXPLORE.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => "nav sub" + (isActive ? " active" : "")}>{label}</NavLink>
          ))}
        </div>
        <div className="foot">
          {update?.restart ? <Upgrade say="Wimym's code changed since it started. To run the new code:" command={update.restartCommand} />
            : update?.available ? <Upgrade say="A new version of Wimym is out. To get it, in a terminal:" command={update.command} /> : null}
          <span className={"live" + (busy ? " busy" : core ? "" : " wait")}><i />{busy ? state?.label || `Reading transcripts ${fmtN(state?.done)} / ${fmtN(state?.total)}` : state?.phase === "error" ? "The engine hit an error; showing the last good data" : core ? `Up to date, ${new Date(core.generated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}</span>
          <button className={"sharesw" + (shareOn ? " on" : "")} role="switch" aria-checked={shareOn} onClick={() => setShare(!shareOn)}
            title="Hide what you wrote and the names of your projects, keep the shapes and numbers, so the page can be shown">
            <i aria-hidden="true" />Share mode
          </button>
          <Postcard compact />
        </div>
      </nav>
      <main className="page">{empty ? <Empty title={loc.pathname === "/" ? "Where is your mind?" : undefined} /> : <Outlet />}</main>
      {shareOn && <button className="sharechip" onClick={() => setShare(false)}><span className="long">Share mode: words and project names are hidden.</span><span className="short">Share mode</span> <u>Turn off</u></button>}
    </div>
  );
}

/** A newer Wimym, or newer code than the engine runs: what to type, copied on a click. */
function Upgrade({ say, command }: { say: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  return (
    <div className="upgrade" role="status">
      {say}
      <button onClick={copy} title="Copy the command"><code>{command}</code><span>{copied ? "Copied" : "Copy"}</span></button>
    </div>
  );
}
