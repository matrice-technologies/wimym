/** Said in place of a page when there is nothing of yours to read yet. */
export default function Empty({ title = "Nothing to show yet" }: { title?: string }) {
  return (
    <div className="wrap narrow" style={{ paddingTop: "12vh" }}>
      <h1 className="title">{title}</h1>
      <p className="lede">Wimym reads the conversations Claude Code keeps in <code>~/.claude/projects</code>, and there are none there yet.</p>
      <p className="lede">Use Claude Code for a day and come back. This page fills in by itself while Wimym runs.</p>
    </div>
  );
}
