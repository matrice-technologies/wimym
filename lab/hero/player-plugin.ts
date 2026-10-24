// postcardPlayer(): `import player from "virtual:postcard-player"` gives the postcard page's script (postcard-player.ts)
// bundled into one string, for the page to carry inline. Used by the app's Vite and the lab's; each passes its own
// esbuild, so the lab needs no node_modules for the app to build.
type Build = (o: never) => Promise<{ outputFiles?: { text: string }[]; metafile?: { inputs: Record<string, unknown> } }>;
const ID = "virtual:postcard-player", RESOLVED = "\0" + ID;
// paths from file URLs without node's types, which the lab's tsconfig doesn't load
const path = (u: URL) => decodeURIComponent(u.pathname);
const LAB = new URL("../", import.meta.url), ENTRY = path(new URL("./postcard-player.ts", import.meta.url));

export function postcardPlayer(build: Build) {
  return {
    name: "postcard-player",
    resolveId: (id: string) => (id === ID ? RESOLVED : null),
    async load(this: { addWatchFile(f: string): void }, id: string) {
      if (id !== RESOLVED) return null;
      const out = await build(({ entryPoints: [ENTRY], bundle: true, write: false, format: "iife", minify: true, target: "es2020",
        legalComments: "none", logLevel: "error", metafile: true, absWorkingDir: path(LAB),
        // the aurora's worker is never made on the page (worker: false); its import.meta.url goes unread
        logOverride: { "empty-import-meta": "silent" } }) as never);
      for (const f of Object.keys(out.metafile?.inputs ?? {})) this.addWatchFile(path(new URL(f, LAB)));
      return `export default ${JSON.stringify(out.outputFiles![0].text)};`;
    },
  };
}
