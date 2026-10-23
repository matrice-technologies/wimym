# The hero

The first thing anyone sees on the front page: your days as a planet. Each day is a line of
latitude, March at the south pole and today at the north. Longitude is the hour. Land is the part
of each day you were at it, first message to last, so your habits draw the coastlines and days off
are open sea. Every message is a light. The sun stands over 13:00 and the planet faces you with its
night side, so the lights you see are the hours you worked after dark: amber in the evening,
orange, then red after eleven.

Three other pictures of the same data ride along behind the same component (`piece`): the nebula,
the core sample and the organism. See them in the lab (`npm --prefix lab run dev`, then
<http://localhost:5194/>), each with its own page.

## Use

```tsx
import { Hero } from "@wimym/hero";

<Hero
  points={points}                // GET /api/points as is (96 KB gzipped): the light way in
  days={core.days}               // the app's Core.days from /api/core, as is (optional with points)
  theme={resolvedTheme}          // "light" | "dark"
  share={shareMode}              // shapes only: tooltips give a time, never text or a project name
  shift={wide ? 0.17 : 0}        // move the planet right of centre to leave room for the headline
  onCaption={setCaption}         // { line, sub }: one sentence from the data, for the words beside it
  onSelect={day => nav(`/days/${day}`)}   // a click on a light: its day
  style={{ height: "100svh" }}   // it fills its box; give the box a height
/>
```

| Prop | Default | What it does |
|---|---|---|
| `points` | | `GET /api/points` as is (docs/contract-points.md). With it, a message's words are fetched one at a time on hover (`/api/points?ids=1` once, then `/api/message/<id>`), never in share mode. |
| `messages`, `days` | | Or the app's `Message[]` and `Core.days`. With `points`, `days` is optional: without it the days are worked out from the points (no nights' lengths or switches, which the planet doesn't need). |
| `piece` | `"planet"` | `"planet"`, `"nebula"`, `"core"` or `"organism"` (the organism also reads `/api/vitals`). |
| `theme` | required | Redraws in place when it changes. |
| `share` | `false` | Can change at any time; from then on no text or project name leaves the component. |
| `motion` | `"auto"` | `"auto"` follows `prefers-reduced-motion`; `"still"` draws one frame and holds it; `"full"` always moves. |
| `fallbackSrc` | a still | The image shown where WebGL isn't available. |
| `labels` | `true` | The small words on the picture: today, March, midnight. |
| `tooltips` | `true` | The day under the pointer: date, hours, messages after 9 pm; outside share mode the nearest message's first words and project. |
| `shift` | `0` | Moves the subject sideways by a share of the width. |
| `onSelect` | none | Called with `YYYY-MM-DD` on a click (not a drag) on a light. |
| `onCaption` | none | Called with `{ line, sub }` whenever they change. |
| `className`, `style` | | On the box. |

A ref gives `savePNG(withCaption = true)` and `recordLoop(seconds = 6)`.

`syntheticData()` returns messages and days in the same shapes for someone who never existed, for
demos and for a first visit before anything is indexed.

The planet rocks gently around 22:20 and can be thrown round with a drag; it comes back to face its
night. It pauses when off screen. On the first visit in a browser session it makes one entrance:
your messages appear as the nebula's spiral of stars and fall onto the planet over about three
seconds, March first. Reduced motion and later visits skip it.

Hovering a latitude rings that day and gives its date, hours and how many messages came after
9 pm; outside share mode it adds the message nearest the pointer. A click calls `onSelect(day)`.

Where WebGL isn't available it shows a still (`fallback-planet-dark.jpg`, `-light.jpg`, drawn on
made-up data), or `fallbackSrc`. `onCaption` isn't called then; the app keeps its own words.

Measured on this Mac at 1440x900 and 2x DPR (a 2880x1800 canvas): about 95 fps in dark (median
8.7 ms, 95th percentile 17 ms, with the bloom) and 120 fps in light.

## The first run

`FirstRun` is the hero for someone whose index is still being built. While the engine reads, a
star arrives for each message it finds, on the same spiral the planet's entrance starts from, and a
line says what is happening in plain words ("Reading 1,551 conversations… 812 so far.", then the
first day, the prompt history, git, measuring). When the engine is ready and the data is here, the
stars hand over to the planet, which makes its entrance. However quick the build, the show lasts at
least `minSeconds` (2.6 s by default) and each step is on screen for at least 0.9 s. A person whose
engine is already up to date (`phase: "ready"`, `first: false`) goes straight to the planet.

```tsx
import { FirstRun } from "@wimym/hero";

<FirstRun
  state={engineState}                         // GET /api/state → .state, every second while first is true
  points={engineState?.first === false ? points : null}   // the data once it exists (or messages and days)
  theme={theme} shift={wide ? 0.17 : 0}       // and any other Hero prop, passed on to the planet
  onDone={() => setFirstRunOver(true)}
  style={{ height: "100svh" }}
/>
```

Props: everything `Hero` takes except `points`, `messages`, `days` and `entrance`, plus `state`,
`points` or `messages`/`days` (null until the data exists), `minSeconds`, `narrate` (draw the
line, default true), `onLine(line, detail)` (to draw it yourself), `onDone()`.

`EngineState` is docs/contract-state.md's `state`. The engine's `label` is shown as is ("Reading
4,600 transcripts… 1,136 so far", "Measuring your weeks"); the line under it comes from `found`.
The planet takes over once `first` is false and the data is here, without waiting for git, which
the engine reads after the first page is up. `mockEngineState(elapsed, seconds, totals)` plays a
whole first run of any length in the contract's shape; `hero/first-run.html` uses it (`?seconds=2`
for a new person's quick build, `?seconds=34` for Alex's from nothing, `?real` to poll the engine).

## The postcard

`savePostcard` makes the picture Alex will post: the planet in share mode, "Where is your mind?",
three true lines computed from the record, and a small Wimym mark. No project names, no message
text: counts and times only.

- 1200x630 (`format: "landscape"`, link previews, X, LinkedIn) or 1080x1350 (`"portrait"`, Instagram).
- Dark by default, or `theme: "light"`.
- Saves a PNG (unless `download: false`) and returns the canvas.

The lines, from `postcardLines(mind)`, read like "15,476 messages to AI agents since March.",
"85 days in a row, and counting." and "2,575 sent after 9 pm, the latest at 01:52.". A run under
seven days becomes "At most N days in a row."; no late messages becomes "Not one sent after 9 pm."

```ts
heroRef.current.savePostcard({ format: "portrait" });     // from a Hero on screen
savePostcard(points, core.days, { format: "landscape" });   // or straight from /api/points (days optional), or messages and days
```

## The week's form

`WeekForm` is the week page's header: one living form for the chosen week, moved by its vital signs
against the person's own range (each sign measured in widths of its usual range, from the 8 weeks
before). It morphs when the week changes, so a person feels the difference before reading it.

| Sign (from `/api/week` vitals) | Outside its usual range, the form |
|---|---|
| sessions at once (`peak`) | has one lobe per session; above the range the lobes pull apart |
| switches an hour (`switches`) | drifts apart ("Fragmented") above the range, gathers below it |
| nights (`night`) below, strain (`strain`) above | frays: a turbulent, faster skin |
| days in a row (`streak`) above | beats with a slow, heavy pulse |
| longest stretch (`stretch`) | sets the size of the core and of the whole creature ("Thin at the core") |
| hours of work (`load`) | breathes faster and swells above the range |
| all of them | turns from cool blue (inside every range) toward violet and ember the further outside |

```tsx
import { WeekForm } from "@wimym/hero";

<WeekForm week={weekPayload} vitals={vitals} theme={theme} share={share}
  shift={wide ? 0.2 : 0} onCaption={setCaption} style={{ height: "min(62vh, 560px)" }} />
```

Props: `week` (`GET /api/week?start=…` as is), `vitals` (accepted; the week's own vitals and bands
are what is read), `theme`, `share` (accepted; nothing personal is drawn), `motion` ("auto" follows
reduced motion, "still", "full"), `shift`, `caption` (draw the words under the form, default false),
`onCaption({ line, sub })`, `fallbackSrc`, `className`, `style`. Ref: `savePNG()`.

The caption names the signs that shape it, strongest first: for the week of 12 October "Split: 9
sessions at once, your usual is 5 to 6." then "A slow, heavy pulse: 81 days in a row, your usual run
is 37 to 62. Fragmented: 8.5 session changes an hour, your usual is 6.4 to 8.2."; for 14 September
"A slow, heavy pulse: 53 days in a row, your usual run is 9 to 34." then "Thin at the core: your
longest stretch on one project was 0.5 hours, your usual is 0.6 to 1.1." A week inside every range
says "Calm: every sign inside your usual range." `weekShape(week)` and `weekCaption(week)` are
exported on their own. Watch it at `lab/hero/week.html` (`?week=2026-10-12`, arrow keys to walk).

## Everything `@wimym/hero` exports

- `Hero` (default too), with `HeroProps`, `HeroHandle` (`savePNG`, `recordLoop`, `savePostcard`), `HeroPiece`
- `FirstRun`, `FirstRunProps`, `EngineState`, `narration`, `mockEngineState`
- `savePostcard`, `makePostcard`, `postcardFacts`, `postcardLines`, `PostcardOptions`, `PostcardFormat`
- `WeekForm`, `WeekFormProps`, `WeekFormHandle`, `WeekPayload`, `weekShape`, `weekCaption`
- `syntheticData`, `RawMessage`, `RawDay`, `PointsPayload`, `shapesOf`

New since the first version, all additive: `Hero` props `points`, `entrance` and `fallbackSrc`
(`messages` and `days` became optional), and `HeroHandle.savePostcard`.

## Wiring it into the app

`app/` imports the component from `lab/hero/` directly. Three changes in `app/` (the app session's
files):

1. `app/package.json`: add `"three": "0.170.0"` to dependencies and `"@types/three": "0.170.0"` to
   devDependencies, then `npm install` in `app/`.
2. `app/vite.config.ts`: an alias, one copy of React and three, and permission to read `../lab`:

   ```ts
   import { fileURLToPath } from "node:url";
   // in defineConfig({ ... }):
   resolve: {
     alias: { "@wimym/hero": fileURLToPath(new URL("../lab/hero/index.ts", import.meta.url)) },
     dedupe: ["react", "react-dom", "three"],
   },
   server: { ..., fs: { allow: [".."] } },
   ```

   If `node:url` has no types there, `"@wimym/hero": new URL("../lab/hero/index.ts", import.meta.url).pathname` works too.
3. `app/tsconfig.app.json`: `"paths": { "@wimym/hero": ["../lab/hero/index.ts"] }` under
   `compilerOptions`. The lab code compiles under the app's own strict settings
   (`erasableSyntaxOnly`, `noUnusedLocals` and the rest).

`lab/node_modules` must be installed too (`npm --prefix lab install`) for the fonts the lab pages
use; the component itself needs only `three` and `react`, both taken from the app.

## Files

- `hero/Hero.tsx`, `hero/index.ts`: the component.
- `hero/demo.html`, `hero/demo.tsx`: the component in a mock of the first screen, with postcard buttons.
- `hero/FirstRun.tsx`, `hero/mockState.ts`, `hero/first-run.html`: the first run, its stand-in engine state, and a page to watch it.
- `hero/postcard.ts`: the postcard.
- `src/pieces/*.ts`: the four pictures, each a plain class behind one interface (`src/shared/piece.ts`).
- `src/shared/data.ts`: the shapes drawn, as typed arrays; text stays out of them and is read only for a tooltip.
- `src/shared/vitals.ts`: the week's signs against your own range, for the organism.
