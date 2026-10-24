# The public page

wimym.matricetechnologies.com: what Wimym does and how to set it up. Static: `index.html`, the app's fonts
and tokens, and `media/`, every image and video captured from the demo person (Robin Vale,
`./install.sh --demo`), never from real data: the screenshots at 2x from a 1440 by 900 window, and the postcard films
(`postcard-tall.mp4`, `postcard-wide.mp4`) saved with the app's own Save a postcard. The social image `og.jpg` is the
wide postcard's first frame. Point `WIMYM_DEMO` at a short path (`~/.cache/...`) when capturing: under a long
temporary path the demo's transcripts index with no messages. `/media/` is cached for a week, so when you retake a
file under the same name, bump the `?v=` on every media link in `index.html` (`?v=MMDD`, the day of the retake), or
visitors keep last week's.

Two parts are live: `live/live.js`, built from `lab/site/` with `npm --prefix lab run build:site` (23 KB
gzipped, no React or three). The hero is the strummed Loom and its aurora, the piece the app's This week page
opens on, drawn on a 2D canvas. "A new kind of work" replays one of Robin's days (`lab/site/day.ts`): a string per
project plucked by each message, a clock and counts that run the day in half a minute, and the risks the page names
said at the moment each shows in that day's record. Both read `media/robin.json`, exported from a
demo engine, never from a real one, by `python3 lab/site/export-robin.py` with `./install.sh --demo` running (it
refuses an engine whose projects aren't Robin's). After a new export, pick the day buttons in `#day` from the new
record and copy the default day's moments and counts into the page's no-script text. Rebuild after changing anything
in `lab/site` or the Loom's pieces.

Hosted on Vercel, project `wimym` (shanoirs-projects). To publish a change, from this folder:

```bash
vercel deploy --prod
```

The setup starts with one prompt people paste into Claude Code; it has Claude read `setup.md`, the guide
written for Claude, and follow it step by step. Change the steps there and in the page's "by hand"
list together. Both point at the private repo matrice-technologies/wimym (by invitation).
`bin/ship-code` updates that repo from main.
