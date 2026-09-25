# 🐜 Pixel Picnic

**Feed a hungry ant colony.** Tap boxes of ants and watch them march out, grab the cubes of their
color and carry a 3D pixel‑art picture back to the nest — cube by cube, color by color.
A cozy puzzle game with a surprising amount of planning under the hood.

### ▶ Play now: [evgeny.io/games/pixel-picnic](https://evgeny.io/games/pixel-picnic/)

Works in any modern browser, on phones and on desktop. No install, no ads, no timers.

<p align="center">
  <img src="docs/gameplay.jpg" width="250" alt="Purple ants eating a watermelon picture">
  <img src="docs/map.jpg" width="250" alt="Level map with completed pictures">
  <img src="docs/win.jpg" width="250" alt="Level complete with three stars">
</p>
<p align="center">
  <img src="docs/desktop.jpg" width="820" alt="Desktop layout: ants walking around the frame to eat a picture from the top">
</p>

## How to play

1. Every level is a picture made of colored pieces lying in a wooden tray — cubes, coins, candies,
   hexagons or diamonds, a different look for different pictures.
2. Ants walk around the frame and come in **from any side** that isn't fenced off, then walk over
   free space. **A piece is reachable when there's a free way to it**: from outside, or through the
   tunnels and gaps already eaten into the picture, from any side of the piece.
3. Tap a box at the front of the queue. It hops into a free **slot** (five in the first levels,
   four later) and its ants run out; each ant heads for a reachable piece of its color and claims
   it. The piece stays in place until its ant has walked up and grabbed it — only then is the way
   to the pieces behind it free. The number on the box is how many ants are still inside.
4. When a box is empty, its slot frees up. But if every slot holds a color the ants can't reach
   yet, **the colony gets stuck**. Think a few bites ahead: which column hides the color you need,
   and which boxes can you afford to park on the way?

Every 5th level is **hard**, every 10th is **super hard**.

## Features

- **140 levels in 7 worlds** — Sunny Meadow, Whispering Forest, Seashell Beach, Candy Town,
  Starry Night, Snowy Hills and Enchanted Glade — plus an endless mode that generates new levels
  on the fly.
- **Mechanics that unlock as you play:**

  | From level | Mechanic |
  |---:|---|
  | 1 | Boxes, five slots, ants coming in from every side (with a short tutorial) |
  | 6 | Four slots |
  | 7 | **Mystery boxes** `?` — the color shows only when the box reaches the front |
  | 11 | **Fences** — ants can't get in through a fenced side of the frame |
  | 14 | **Chained boxes** — linked pairs are taken together and need two free slots |
  | 22 | **Ice** — a frozen box can't be taken until a few more taps have been made |
  | 31 | **Gates** — the only way in is a narrow gap in the fence |

- **Boosters bought with the coins you earn:**

  | Unlocks | Booster | What it does |
  |---:|---|---|
  | 2 | 💡 Hint | Asks the solver for the best next box and highlights it |
  | 3 | ➕ Slot | One extra slot for the rest of the level |
  | 4 | ↩️ Undo | Takes back your last tap |
  | 6 | 🔀 Shuffle | Re-deals the queue into an order that can still be finished |
  | 9 | 🧲 Magnet | Pulls any box out of the middle of the queue |

- **Stars and album** — 3 stars without boosters, 2 with them, 1 if the colony got stuck and you
  rescued it. Every finished picture goes into your album.
- **Fast by default** — ants are quick, and 2× / 3× speed is free.
- **Desktop extras** — hover a box to see which cubes its ants could reach right now.
- **English and Russian**, progress saved in the browser.

## Under the hood

- **Deterministic rules engine** ([`src/core/sim.ts`](src/core/sim.ts)). Free space is flood-filled
  from every unfenced border cell, and each color keeps a priority queue of reachable pieces. Every
  105 ms (at 1×) each occupied slot sends one ant to the reachable piece of its color that is
  closest to the nest (walking around the frame to an entrance). The ant claims it, and the piece
  is carried off when the ant arrives — the trip time depends on the distance — which is when the
  cells behind it open up. The 3D view only animates the resulting events, so the game, the solver
  and the level generator share exactly the same rules.
- **Ant paths** — every ant plans its own route: a breadth-first search over the free cells picks
  the entrance that's most convenient from its slot, the route is smoothed into straight runs, and
  ants politely wait behind cubes that another ant hasn't carried away yet.
- **Solver** ([`src/core/solver.ts`](src/core/solver.ts)). A depth‑first search with memoized dead
  ends proves that every level can be finished. The Hint booster runs it live and tells you when
  your position has become unwinnable.
- **Difficulty is measured, not guessed** ([`src/core/generator.ts`](src/core/generator.ts)). The
  generator builds a queue around a known solution, then plays hundreds of simulated games with
  three players — one tapping **at random**, a "casual" one who only takes colors the ants can
  reach, and a greedy one — and tunes the queue (solver-checked local search: swapping, merging,
  splitting and moving boxes) until the win rates land in the band for the level's tier. Random
  tapping wins at most ~10% of normal levels after the first few, ~2% of hard ones and practically
  never on super hard ones; hard levels are also tuned so the thinking doesn't end after the first
  taps (the random player is re-measured from a third of the way in). On top of that it counts
  **critical decisions** — moments on the way to victory where a wrong box leads into a dead end:
  even the first level has some, super hard ones need five or more and beat the greedy heuristic.
  Fewer queue columns and fences are extra difficulty levers.
- **Pictures** — emoji artwork is rasterized, reduced to 3–9 clean colors with k‑means in OKLab,
  cleaned of stray pixels, and placed on patterned backgrounds at 14×13 to 44×44 cubes
  ([`scripts/lib/pixelart.ts`](scripts/lib/pixelart.ts)).
- **Rendering** — three.js with instanced pieces (five shapes), hundreds of instanced ants with
  animated legs, picket fences and gates, golden chains between linked boxes, an ant hill made of
  loose soil grains, soft shadows, a painted ground per world and ambient particles (pollen,
  leaves, fireflies, snow…). Phones get a lighter render path automatically.
- **Sound** — every effect and the generative music of each world are synthesized with the Web
  Audio API; there are no audio files.

```
src/core/     rules, solver, difficulty estimation, level generator, progression
src/render/   three.js scene: picture, queue & slots, ants, nest, particles, ground, layouts
src/game/     real-time driver: simulation rounds ↔ animated view, boosters, undo
src/ui/       HUD, dialogs, level map, album (DOM + CSS)
src/app/      app flow, saves, i18n, level loading, endless-mode worker
src/audio/    Web Audio synthesizer (SFX + generative music)
scripts/      emoji → pixel art, campaign builder, UI icons
```

## Development

```bash
npm install
npm run dev      # http://localhost:5173, also reachable from a phone on the same network
npm test         # rules, solver and generator tests
npm run build    # typecheck + production build into dist/
```

Regenerate content (uses [Bun](https://bun.sh)):

```bash
bun scripts/build-pictures.ts   # contact sheets for reviewing the pixel art in .cache/sheets
bun scripts/build-levels.ts     # campaign → src/data/levels.json (a few minutes)
bun scripts/build-icons.ts      # UI icons
```

**Debug mode** (Settings → Debug mode, or `?debug=1`): every level is unlocked, the map shows each
level's difficulty, the 🐞 button opens a list of all levels with their picture and numbers
(simulated win rates, size, boxes, mechanics), and the pause menu gets *Auto-solve* (the solver
plays the level) and *Skip level*.

Other URL flags: `?level=25` jumps to a level, `?boosters=5`, `?coins=999`, `?progress=14`,
`?demo` (the colony plays by itself), `?reset`.

Pushing to `main` runs the tests, builds the game and publishes it to
`evgeny.io/games/pixel-picnic/` (GitHub Actions; needs a `DEPLOY_TOKEN` secret with write access
to the site repository).

## Credits & licenses

- Level pictures are generated from emoji:
  - [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) — MIT License.
  - [Twemoji](https://github.com/jdecked/twemoji) — © Twitter, Inc. and other contributors,
    graphics licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The
    pictures are modified (rasterized, recolored and pixelated).
- UI icons: Microsoft Fluent Emoji (MIT).
- Font: [Nunito](https://fonts.google.com/specimen/Nunito) — SIL Open Font License 1.1.
- 3D engine: [three.js](https://threejs.org) — MIT.
