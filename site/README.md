# The public page

wimym.matricetechnologies.com: what Wimym does and how to set it up. Static: `index.html`, the app's fonts
and tokens, and `media/`, every image and video captured from the demo person (Robin Vale,
`./install.sh --demo`), never from real data. The social image `og.jpg` is Robin's postcard.

Two parts are live: `live/live.js`, built from `lab/site/` with `npm --prefix lab run build:site` (23 KB
gzipped, no React or three). The hero is the strummed Loom and its aurora, the piece the app's This week page
opens on, drawn on a 2D canvas. "A new kind of work" draws one of Robin's days as a score (`lab/site/day.ts`),
with the risks the page names each found in that day's record. Both read `media/robin.json`, exported from a
demo engine, never from a real one. Rebuild after changing anything in `lab/site` or the Loom's pieces.

Hosted on Vercel, project `wimym` (shanoirs-projects). To publish a change, from this folder:

```bash
vercel deploy --prod
```

The setup starts with one prompt people paste into Claude Code; it has Claude read `setup.md`, the guide
written for Claude, and follow it step by step. Change the steps there and in the page's "by hand"
list together. Both point at the private repo matrice-technologies/wimym (by invitation).
`bin/ship-code` updates that repo from main.
