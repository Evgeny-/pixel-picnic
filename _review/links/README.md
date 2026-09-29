# Always-visible link alternatives

Open `http://127.0.0.1:5173/_review/links/` with the Vite dev server running.

This local design comparison reuses the classic box geometry, mystery texture and meadow ground painter. It does not read or write game saves and is not a production build entry point.

## Accepted direction

**Chosen design: B, Box-color cord.** The counter attachments use the exact +N/? coordinates so a rounded grid route meets them without a one-pixel step.

Every connection must remain visible without tapping. Pair icons are removed. A hidden partner can be represented by a line ending at its actual column's +N or ? counter. Colors should come from the connection's material or the visible box colors, never an arbitrary pair palette.

## Styles

- A: a thin ivory cord with a small highlight and dark outline.
- B: the same cord blending the two visible box colors. Mystery boxes and hidden partners use a neutral endpoint to avoid leaking their colors.
- C: a fine gold chain, alternating rounded oval links with narrow edge-on connectors.
- D: a satin steel chain with larger rounded rectangular links.

## Cases and routing

Busy neighbours has seven connections. Shared gaps has eight, including same-color pairs, crossed routes and two links ending at one hidden counter. These two are explicit stress layouts. The other cases use the exact starting queues, counts, visible colors and link membership from levels 14 and 180, with the game's adjusted palette and front-row mystery reveal rule.

`routing.js` plans all links together once per scene. It reserves different lanes in shared gaps, penalizes overlap and turns, and reserves separate attachment ports when several partners share a hidden counter. Small masked gaps distinguish over/under crossings. Every style uses the same routes. This planner is limited to the review page's fixed dimensions; the game now uses its responsive TypeScript counterpart in `src/render/cordRouting.ts`. `QueueLinks`, `BoxCord` and `QueueCounter` apply the selected Box-color cord design to the real queue, including animation and exact counter pins.

Tap or keyboard-activate a box to highlight its endpoints across all four styles. All other boxes and links stay fully visible. A shared hidden counter cycles through its individual connections. No extra gameplay confirmation tap is proposed.
