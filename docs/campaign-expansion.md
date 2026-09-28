# Campaign continuation: levels 141–280

The second half of the campaign uses the same rules and keeps the first 140 level definitions
unchanged. Every fifth level is hard; every tenth is super hard. Each new world contains 20
different pictures.

| Levels | World | Pictures and setting |
|---|---|---|
| 141–160 | Harvest Hills | Orchard fruit, farm animals and vegetables on an autumn hillside |
| 161–180 | Safari River | Savannah and jungle wildlife, palms and desert plants |
| 181–200 | Harbor Lights | Boats, coastal transport and town buildings on blue stone paving |
| 201–220 | Market Square | Street food, bakery treats and tea on terracotta paving |
| 221–240 | Toy Workshop | Instruments, toys and craft supplies on a wooden floor |
| 241–260 | Skybound Trail | Aircraft, birds, mountains and weather above the clouds |
| 261–280 | Festival Gardens | Flowers, lanterns, festival decorations and rides |

## Progression

All new boards fit within 34×34 cells, including background borders. Four slots and three
visible queue rows remain the standard. The ordinary levels show how many boxes remain in each
column. Hidden boxes appear selectively, so the difficulty comes mainly from ordering moves.

The route plans alternate open boards, fenced approaches and paired entrances. Later stages
combine these with more linked pairs and frozen boxes. A fully enclosed board always has a gate
at least four cells wide. New backgrounds are painted into cached textures; they add no board
geometry. The soundtrack uses seven additional arrangements of the existing synthesized instruments.

The generator's minimum target rises from six to eight critical decisions on ordinary levels,
eight to ten on hard levels and ten to twelve on super-hard levels. These are tuning targets,
not a claim that every human will find a particular stage equally difficult. A critical decision
is a branch where an alternative move fails within the solver's search budget.

## Validation and review

`tests/campaign.test.ts` replays every stored solution through the real simulation without
boosters. It also checks color totals against box contents, queue membership, numbering,
artwork identity and board-size limits. A digest protects all 140 published level definitions.
The palette tests cover the full campaign under the existing normal, warm-display and
bright-surface stress models.

```bash
npm test
npm run build
bun scripts/audit-campaign.ts
```

The audit writes its results and one contact sheet per new world to `.cache/campaign-audit/`.
It uses 96 independent runs for each random, casual and greedy policy, plus 12 short-horizon
planner runs per level. Contact sheets use the same adjusted palette as the game.
These simulated win rates are diagnostic samples; the executable solutions prove solvability.

The completed batch passed 474 tests and the production build. A separate audit sampled all
140 new levels with fresh seeds, totaling 42,000 simulated games:

| Tier | Levels | Casual wins | Greedy wins | Planner wins | Mean critical decisions |
|---|---:|---:|---:|---:|---:|
| Normal | 112 | 7.6% | 19.0% | 80.3% | 8.2 |
| Hard | 14 | 2.1% | 2.8% | 50.0% | 9.5 |
| Super hard | 14 | 1.7% | 1.8% | 32.7% | 11.3 |

Visual review covered every new picture using the game's adjusted palette. Browser checks
included a complete animated win on level 141, mobile and desktop layouts on level 200,
and the new world map and backgrounds.

When a queue needs adjustment, `bun scripts/refine-campaign.ts input.json output.json` preserves
the picture and fence layout while comparing replacement queues with two planner seeds. Set
`LEVELS=141,145` to limit the work. Re-run the audit and review its contact sheets after refinement.

For local playtesting, open `http://127.0.0.1:5173/?level=141&debug=1`. Debug mode unlocks the map,
shows the difficulty figures and exposes Auto-solve in the pause menu. The campaign continues
into freshly generated endless levels after 280.

## Artwork

The new selection adds 168 candidate pictures from the existing Noto, Fluent Emoji and Twemoji
packages. Only 140 are selected for the campaign. Each selected source/icon pair is new to this
campaign, and the source inventory is kept in `scripts/expansion-pictures.ts` and the audit report.

All pictures are rasterized, reduced to a small palette and pixelated. The existing attributions
in the game's Authors & licenses dialog apply: Noto Emoji (Apache 2.0), Microsoft Fluent Emoji
(MIT), and Twemoji (CC BY 4.0). No additional art packages or runtime downloads are required.
