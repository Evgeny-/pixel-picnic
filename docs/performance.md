# Performance checks

Run `npm run dev`, then open this local scenario in the browser being tested:

`http://localhost:5173/?level=35&creature=mouse&looks=cottage,flower,classic&perf=1&debug=1`

Use the same window size, game speed and selection sequence for comparisons. Fill the slots
and queue a few boxes. Let the renderer warm up before recording a result. Test ants as a
baseline by changing `creature=mouse` to `creature=ant`. Repeat on a phone-sized viewport.
Avoid running builds or CPU benchmarks during a browser measurement. The debug auto-solver
performs synchronous search, so use manual play when measuring normal gameplay stutters.
For a repeatable recorded sequence, add `&demo=6` to the performance URL. This plays the
level's stored solution without running a solver. With `perf=1`, demos use the normal RAF
loop and never run the screenshot timer's extra updates/renders.

The optional overlay reports frame cadence, CPU time, the slow-frame tail of the distribution,
active creatures, draw calls, triangles and render pixel ratio. The console receives a bounded
frequency of local diagnostic summaries. Nothing is sent to a server. Without `perf=1` the
monitor does not create an overlay, collect samples or write logs.

`renderSubmit` measures JavaScript submitting WebGL work. It does not measure GPU execution.
An interval between animation frames can also include browser scheduling, compositing, garbage
collection or other tasks. A long frame is not proof that path finding caused it. Pauses and
hidden tabs are excluded from cadence measurements.

The last frame above 100 ms gets a separate line with **that frame's** CPU/render-submit
time. The following line shows overlapping measured input/solver/resize tasks, or an
unmeasured gap. This avoids comparing a worst frame with the average CPU time. The local
overlay's `data-report` attribute contains the current statistics and the last 20 slow-frame
records; console details are JSON strings. A gap is not a GPU timing measurement. Initial
shader/texture preparation can appear in this history, so record when a spike occurred.

The 3D renderer gradually reduces pixel density during sustained slow rendering and recovers
it after a longer fast period. The HTML interface stays at the screen's native resolution.
For controlled comparisons, add `&dpr=2` or `&dpr=1.25` while `perf=1`; this fixes the density
and disables adaptive scaling. Use no DPR override when checking the default experience.

## Repeatable checks

- `npm test` includes a limit of 2,000 triangles per creature, including all its legs and tail,
  and 700 triangles per hat. Framing tests cover full turns with accessories.
- `npm exec -- vite-node scripts/bench-paths.ts` measures level 35 path planning at three stages
  with deterministic inputs and route signatures. Its microseconds per route are CPU figures,
  not browser FPS.
- Compare p95, p99, longest frame and the share of frames above 33/50/100 ms as well as average
  FPS. Record browser, viewport, DPR, species, accessory, speed and active creature count.

Keep animated colonies instanced. A tail adds one draw call for the entire group. Upload only
active matrix/color ranges, and update picture matrices only for pieces that changed.
Live box counters share a static atlas prepared when the level opens. Changing a number
updates only the label's small position/UV buffers, avoiding canvas uploads and mipmap
generation on every dispatch round. Shop previews retain their static label textures.
Picture pieces reuse identical position/normal vertices: the cube uses 56 vertices instead
of 324. The triangle count and rendered shape are unchanged. Tests compare the full expanded
triangle stream, including normals, to catch changes to the bevels or faceted edges.
