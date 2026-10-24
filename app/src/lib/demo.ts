// The demo build (vite build --mode demo, for wimym.matricetechnologies.com/demo): the app on Robin's record, a
// made-up person, with no engine behind it. Every GET to /api is answered from the static files that
// lab/site/export-demo.py wrote under the build's api/, and nothing can be changed. Imported first by main.tsx,
// so the lab's pieces (the Loom, the organism) are answered the same way.

export const DEMO = import.meta.env.MODE === "demo";

/** ?embed=page: one page in a frame, no scrolling. ?embed=<id>: only the element with that id, its height told to the parent. */
export const EMBED: string | null = DEMO ? new URLSearchParams(location.search).get("embed") : null;

// message details are kept in SHARDS files by a hash of their id (export-demo.py's shard(), the same FNV-1a)
const SHARDS = 64;
export function shard(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h % SHARDS;
}

/** The file for an /api path: /api/core is api/core.json, /api/week?start=X is api/week/start=X.json. */
export function file(path: string) {
  return `${import.meta.env.BASE_URL}api/${path.slice(5).replace("?", "/")}.json`;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

if (DEMO) {
  const real = window.fetch.bind(window);
  const shards = new Map<number, Promise<Record<string, unknown>>>();
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return real(input, init);
    if ((init?.method ?? "GET").toUpperCase() !== "GET") return json({ error: "This is a demo on a made-up person: nothing is saved." }, 403);
    const path = url.pathname + url.search;
    const one = path.match(/^\/api\/message\/(.+)$/);
    if (one) {
      const id = decodeURIComponent(one[1]), n = shard(id);
      if (!shards.has(n)) shards.set(n, real(file(`/api/message/${n}`)).then(r => (r.ok ? r.json() : {})).catch(() => ({})));
      const m = (await shards.get(n)!)[id];
      return m ? json(m) : json({ error: "not found" }, 404);
    }
    return real(file(path));  // the files change only with a deploy: the browser may keep them (site/vercel.json)
  };
  if (EMBED) {
    document.documentElement.classList.add("embed");
    if (EMBED !== "page") document.documentElement.classList.add("embed-one");
  }
}

/** ?embed=<id>: once the element is on the page, show it alone and keep the parent told of its height. */
export function embedOne(id: string) {
  let sized: ResizeObserver | null = null;
  const find = () => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.add("embed-target");
    // from the top of the page to its bottom: what the frame must show
    sized = new ResizeObserver(() => parent.postMessage({ wimym: "embed", id, height: Math.ceil(el.getBoundingClientRect().bottom + scrollY) }, location.origin));
    sized.observe(el);
    return true;
  };
  if (find()) return () => sized?.disconnect();
  const watch = new MutationObserver(() => { if (find()) watch.disconnect(); });
  watch.observe(document.body, { childList: true, subtree: true });
  return () => { watch.disconnect(); sized?.disconnect(); };
}
