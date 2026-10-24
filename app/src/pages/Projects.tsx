import * as d3 from "d3";
import Loading from "../components/Loading";
import { useState } from "react";
import { Link } from "react-router-dom";
import Strata from "../components/Strata";
import { useTip } from "../components/Tip";
import { useData } from "../lib/data";
import { FAMILIES, famColor, fmtDay, fmtK, fmtN } from "../lib/format";
import { useWidth } from "../lib/hooks";
import type { Project } from "../lib/types";

const SORT: Record<string, [string, (a: Project, b: Project) => number]> = {
  n: ["Messages", (a, b) => b.n - a.n],
  last: ["Most recent", (a, b) => (a.last < b.last ? 1 : -1)],
  commits: ["Commits", (a, b) => b.commits - a.commits],
  claude: ["Claude's hours", (a, b) => b.claudeH - a.claudeH],
};

export default function Projects() {
  const { core } = useData();
  const [sort, setSort] = useState("n");
  const [all, setAll] = useState(false);
  if (!core) return <Loading label="Gathering your projects" />;
  const ps = [...core.projects].sort(SORT[sort][1]);
  const shown = all ? ps : ps.filter(p => p.n >= 10);
  const weeks = core.weeks.map(w => w.week);
  return (
    <div className="wrap">
      <h1 className="title">Projects</h1>
      <p className="lede">{core.projects.length} projects since {fmtDay(core.profile.since, { day: "numeric", month: "long" })}. The top five hold {Math.round((100 * d3.sum(core.projects.slice(0, 5), p => p.n)) / d3.sum(core.projects, p => p.n))}% of your messages.</p>
      <section className="block" style={{ marginTop: 36 }}>
        <div className="panel"><Strata projects={core.projects} weeks={weeks} eras={core.profile.eras} /></div>
      </section>
      <section className="block">
        <header>
          <div><h2 className="section">Each project's life</h2>
            <p className="sub" style={{ margin: 0 }}>When you worked on it (each tick a week, darker for more messages), and what you asked of it.</p></div>
          <div className="seg">{Object.entries(SORT).map(([k, [l]]) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}</div>
        </header>
        <Lives projects={shown} weeks={weeks} />
        {!all && ps.length > shown.length && <button className="pill" style={{ marginTop: 14 }} onClick={() => setAll(true)}>Show {ps.length - shown.length} smaller projects</button>}
      </section>
    </div>
  );
}

function Lives({ projects, weeks }: { projects: Project[]; weeks: string[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const max = d3.max(projects, p => d3.max(p.weekly)) || 1;
  const tl = Math.max(240, w - 660);  // the other columns and gaps take 650
  const x = d3.scaleBand<number>().domain(d3.range(weeks.length)).range([0, tl]).paddingInner(0.15);
  return (
    <div ref={ref} className="panel lives scroll-x">
      <div className="lrow lhead"><span>Project</span><span style={{ width: tl }}>Weeks</span><span>Mix</span><span className="r">Messages</span><span className="r">Commits</span><span className="r">Claude's hours</span></div>
      {projects.map(p => {
        const tot = d3.sum(Object.values(p.fam) as number[]) || 1;
        return (
          <div className="lrow" key={p.project}>
            <Link className="lname" to={`/messages?project=${encodeURIComponent(p.project)}`}>{p.project}</Link>
            <svg width={tl} height={22} style={{ display: "block" }}>
              {p.weekly.map((v, i) => (
                <rect key={i} x={x(i)} y={3} width={x.bandwidth()} height={16} rx={2} fill={v ? "var(--focus)" : "var(--line)"} opacity={v ? 0.15 + 0.85 * Math.sqrt(v / max) : 0.5}
                  onMouseMove={ev => tip.show(<div><b>{p.project}</b><div className="m">Week of {fmtDay(weeks[i], { day: "numeric", month: "short" })}: {fmtN(v)} messages</div></div>, ev.clientX, ev.clientY)}
                  onMouseLeave={() => tip.hide()} />
              ))}
            </svg>
            <span className="lmix" title={FAMILIES.map(f => `${f.name} ${Math.round((100 * (p.fam[f.key] || 0)) / tot)}%`).join(", ")}>
              {FAMILIES.map(f => p.fam[f.key] ? <i key={f.key} style={{ flex: p.fam[f.key], background: famColor(f.key) }} /> : null)}
            </span>
            <span className="r num">{fmtN(p.n)}</span>
            <span className="r num">{fmtN(p.commits)}</span>
            <span className="r num">{p.claudeH >= 1 ? `${fmtK(p.claudeH)} h` : "<1 h"}</span>
          </div>
        );
      })}
    </div>
  );
}
