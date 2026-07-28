# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

```bash
pnpm install              # install deps
pnpm run dev               # vite dev server (--host), port 5173
pnpm run worker:dev          # wrangler dev (API + Durable Object), port 8787
pnpm run build                 # tsc -b && vite build
pnpm run deploy                  # build + wrangler deploy (single Worker, assets + API)
pnpm run lint                      # eslint .
pnpm run preview                    # preview production build (frontend only, no API)
pnpm run cf-typegen                  # regenerate Cloudflare Worker types from wrangler.jsonc
```

There is no test suite. There is no single-file lint/typecheck shortcut beyond the commands above
(`tsc -b` type-checks `src/`, `worker/src/`, and `data/` as separate project references; `eslint .`
lints the whole repo including `worker/`).

Run `pnpm run dev` and `pnpm run worker:dev` **in parallel** for local development — the frontend
proxies `/api/*` to the local Worker (see `vite.config.ts`), so open `localhost:5173`, not 8787.

## Architecture

React + Vite frontend, Cloudflare Workers + Durable Objects backend, single Worker serving both
under one domain (`assets` binding for everything except `/api/*`, `run_worker_first: ["/api/*"]`
routes API traffic to the Worker — see `wrangler.jsonc`). No CORS needed in dev or prod.

Each game is a "room" (`/room/<id>`): one Durable Object instance per room (`env.ROOM.getByName(roomId)`
— the roomId is the stable key the Worker itself generates on creation, so `getByName` hashes it
deterministically without needing an external id↔instance mapping). Rooms are single-player for
now: the id lives in the URL and in `localStorage` purely for convenience (no auth, no token) — the
model deliberately leaves room to add real multiplayer sync on the same Durable Object later
(e.g. WebSockets) without redesigning the storage layer.

### Data flow: word bank → server-generated puzzle → room state → client

1. **`data/word-bank.json`** — hand-edited source of truth. Each entry: `{ id, answer, clue, category }`.
   `answer` must already be normalized (uppercase, no accents, no spaces). Only the Worker imports
   this file now (`worker/src/room.ts`) — the client never receives it, and never receives any
   `answer` field over the network. This closes a leak that existed in the old static-build model,
   where the whole bank (including answers) was bundled directly into the client.
2. **`worker/src/generator.ts`** (zero dependencies, pure functions, ported from the old
   `scripts/generate-puzzles.mjs` build-time script — that script and the static
   `public/puzzles/*.json` files it produced are gone) — samples a random 15–20 word subset from
   the bank and does greedy grid placement: longest word first, each subsequent word matched
   against existing letters and placed perpendicular at the highest-scoring (most intersections)
   valid position. Any placement where an entry ends up with zero intersections invalidates the
   whole attempt (retried with a reshuffled order, then with a new subset). Fails loudly — returns
   `null` if it can't produce a valid puzzle within the attempt budget, and the Worker turns that
   into a `500` — it must never serve a broken puzzle. There's no more Jaccard-diversity check
   between puzzles (that existed only to keep a fixed pool of 10 static puzzles distinct from each
   other; irrelevant now that every room generates one isolated puzzle).
3. **`worker/src/room.ts`** — Durable Object `Room`. Storage has exactly two keys: `puzzle`
   (structural grid — `wordId`/`number`/`orientation`/`row`/`col`/`length`/`cellRefs`, no `answer`,
   no `clue`) and `solved` (`string[]` of solved `wordId`s). `revealedCells` is never persisted —
   it's derived on every read from `solved` + `puzzle.entries` + the bank, avoiding a
   two-pieces-of-mutable-state desync bug. RPC methods: `createPuzzle(roomId)`, `getState(roomId)`,
   `submitAnswer(entryId, value)` (validates server-side via `worker/src/validator.ts`, idempotent
   if the entry was already solved).
4. **`worker/src/index.ts`** — HTTP routes: `POST /api/rooms` (create, retries on the
   negligible-probability roomId collision), `GET /api/rooms/:id` (resume), `POST
   /api/rooms/:id/answers` (submit). Each request routes to its Durable Object via
   `env.ROOM.getByName(roomId)`.
5. **Client** (`src/state/roomClient.ts`) fetches room state at runtime — `createRoom()`,
   `getRoom(roomId)`, `submitAnswer(roomId, entryId, value)`. A `Puzzle.entries[].clue` field
   carries the clue text inline (server-resolved from the bank by `wordId`); the client has no
   bank of its own to look anything up in.

### Client state

- `src/state/types.ts` — shared interfaces (`PlacedEntry` — now carries `clue` inline —, `Puzzle`,
  `Progress`, `RoomState`, `SubmitResult`, `Rect`).
- `src/state/puzzleReducer.ts` — `puzzleReducer` is a **plain** reducer now (no longer a
  `bankById`-closing factory — validation moved server-side, so the reducer doesn't need the bank
  at all). Actions: `HYDRATE` (sets puzzle + progress, used both right after creating a room and
  after resuming one — see `initFromRoom` in `App.tsx`, called once via `useReducer`'s lazy-init
  argument, not as a runtime dispatch), `SELECT_ENTRY`, `DESELECT`, `SUBMIT_ANSWER_START`,
  `SUBMIT_ANSWER_SUCCESS` (correct → merges into `solvedEntryIds`/`revealedCells`; incorrect →
  `lastSubmissionWasWrong: true`), `SUBMIT_ANSWER_FAILURE` (network/server error — deliberately
  **separate** from "wrong answer": it must not trigger the shake animation, since it means the
  submit never got validated at all, not that the user typed something wrong). `submitting: boolean`
  disables the input/submit button while a request is in flight.
- **No `src/state/validator.ts` anymore** — answer comparison (`normalizeAnswer`/`checkAnswer`) now
  lives server-side only, in `worker/src/validator.ts`. Duplicated rather than shared via a
  workspace package: it's ~15 lines, not worth the overhead.

### Components

- **`GridView`** — unchanged by the backend migration. Renders the full grid collapsed (no letters)
  except for cells in `revealedCells`. Only a cell that is the *start* of an entry is
  clickable/focusable (per-cell `data-entries` attribute lists which entry id(s) start or pass
  through it). Clicking a start cell selects the first unsolved entry among those starting there
  (handles the H/V-share-a-number ambiguity without a separate toggle interaction). Recently-solved
  cells get a transient "floodlight" pulse class, computed by diffing `solvedEntryIds` against the
  previous render and skipped under `prefers-reduced-motion`.
- **`ZoomOverlay`** — modal for the active entry: clue text (now `entry.clue` directly, no separate
  `bankEntry` prop) + one `<input maxLength=1>` box per letter, auto-advancing focus, with cells
  already present in `revealedCells` rendered locked/prefilled. Inputs and the submit button
  disable while `submitting` (answer submit is now an async round-trip to the Worker, not a
  synchronous local check). The FLIP-style "slides in from where you clicked" animation reads
  `initialRect` (computed in `App.tsx` from the clicked cells' `getBoundingClientRect()` via
  `[data-entries~="id"]`) and animates a translate from that rect to the modal's resting position
  in a `useLayoutEffect` (skipped under `prefers-reduced-motion`). Wrong-answer shake uses the
  render-time "adjusting state" pattern (compare `wasWrong` against a `prevWasWrong` ref-in-state,
  not `setState` synchronously inside `useEffect`) — this specific shape exists to satisfy the
  `react-hooks/set-state-in-effect` lint rule; don't collapse it back into a plain effect. This
  pattern is untouched by the backend migration — it's still fed by the same
  `lastSubmissionWasWrong` boolean, just arriving after a network round-trip instead of
  synchronously.
- **`App.tsx`** — `resolveRoom()` (runs once on mount, same `cancelled`-flag pattern as the old
  manifest-fetch effect) resolves a room from, in order: the URL path (`/room/<id>`), then
  `localStorage['crossword-futbol:room-id']`, then falls back to creating a new room —
  `window.history.replaceState` keeps the URL and localStorage in sync with whichever room ended
  up active. No router library: a single dynamic route, parsed by hand, is enough.

### Design system

Single fixed dark theme (not OS light/dark aware — the "stadium at night" look is deliberate),
defined as CSS custom properties in `src/index.css`: `--pitch-dark`, `--pitch-line`, `--chalk`,
`--flood-gold`, `--foul-red`, `--ink`, plus `--font-display` (Oswald, scoreboard/cell numbers) and
`--font-body` (Inter, clues/UI text), loaded via Google Fonts `<link>` in `index.html`. Reuse these
tokens rather than introducing new colors/fonts.
