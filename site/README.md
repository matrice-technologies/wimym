# The public page

wimym.matricetechnologies.com: what Wimym does and how to set it up. Static: `index.html`, in Matrice's
design language (matrice-website-v2's tokens, fonts and components, ported to plain CSS), `demo/`, and `media/`, every
image and video captured from the demo person (Robin Vale, `./install.sh --demo`), never from real data: the postcard
films (`postcard-tall.mp4`, `postcard-wide.mp4`) saved with the app's own Save a postcard. The social image `og.jpg` is
the wide postcard's first frame. Point `WIMYM_DEMO` at a short path (`~/.cache/...`) when capturing: under a long
temporary path the demo's transcripts index with no messages. `/media/` is cached for a week, so when you retake a
file under the same name, bump the `?v=` on every media link in `index.html` (`?v=MMDD`, the day of the retake), or
visitors keep last week's.

`demo/` is the app itself on Robin's record, at /demo: the app built in its demo mode (`app/src/lib/demo.ts`), which
answers every `/api` read from the files the demo engine's answers were saved to under `demo/api/`, and saves nothing.
The pictures in "What it shows" are frames of it, drawn at the app's width and scaled into the page: `?embed=page` for
a whole page, `?embed=<id>` for one part of one (`health`, `week`), loaded as each comes near the screen. Rebuild it,
data and app together, with `./install.sh --demo` running (and before every deploy, below):

```bash
python3 lab/site/export-demo.py
```

It refuses an engine that isn't the demo, shows Robin's demo home as `/Users/robin`, writes nothing it finds a path or
the name of this computer in, and warns if a day the page frames (`/demo/days/...`) isn't in the record. A frame of one
part tells its height once drawn; keep its `data-h` and `aspect-ratio` at that height, or the page below it jumps.

Two parts are live: `live/live.js`, built from `lab/site/` with `npm --prefix lab run build:site` (23 KB
gzipped, no React or three). The hero is the strummed Loom and its aurora, the piece the app's This week page
opens on, drawn on a 2D canvas. "A new kind of work" replays one of Robin's days (`lab/site/day.ts`): a string per
project plucked by each message, a clock and counts that run the day in half a minute, and the risks the page names
said at the moment each shows in that day's record. Both read `media/robin.json`, exported from a
demo engine, never from a real one, by `python3 lab/site/export-robin.py` with `./install.sh --demo` running (it
refuses an engine whose projects aren't Robin's). After a new export, pick the day buttons in `#day` from the new
record and copy the default day's moments and counts into the page's no-script text, and its number of projects into
the strings' `--lanes`: the page keeps the replay's room from that before the record comes, so nothing below it jumps.
Rebuild after changing anything in `lab/site` or the Loom's pieces.

Hosted on Vercel, project `wimym` (shanoirs-projects). `demo/` isn't kept in git: build it before every deploy, with
`./install.sh --demo` running, then publish from this folder:

```bash
python3 ../lab/site/export-demo.py && vercel deploy --prod
```

The setup starts with one prompt people paste into Claude Code; it has Claude read `setup.md`, the guide
written for Claude, and follow it step by step. Change the steps there and in the page's "by hand"
list together. Both point at the public repo matrice-technologies/wimym, whose `main` is what people run.
