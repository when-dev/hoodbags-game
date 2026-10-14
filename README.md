# HoodBags — The Bull Run (web demo MVP)

A browser playable of the **first chapter** from the HoodBags media kit: a 3-lane runner where
**Naz** rides his hoverboard through **The Hood → The Trenches → Bull City**, stacking **$HB**,
dodging **rug pulls, fake airdrops and market crashes**, while **Eazy** feeds (mostly correct) intel
and **Liq** applies the pressure. The run ends at the golden bull.

Three.js + Vite, no other runtime dependencies. All 3D characters and the world are procedural.
The media-kit art is used for menus, portraits and the victory card.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
npm test           # 42 tests: animation, lane motion, timing, instancing, quality, fairness, and the real game loop headless
npm run build      # static site in dist/ (~1.1 MB)
npm run preview    # serve the production build
npm run sim:bench  # Node benchmark of the real game loop (CPU per frame + estimated draw calls), see "Performance"
```

Deploy: any static host (drag `dist/` onto Netlify Drop, `npx vercel`, Cloudflare Pages).

> WSL note: if `node_modules` was installed from Windows, Vite/rollup under WSL needs the Linux
> binaries too (`@rollup/rollup-linux-x64-gnu`, `@esbuild/linux-x64`). Install from the shell you run in.

## How it plays

| Input | Action |
|---|---|
| ← → / A D / swipe | switch lane |
| ↑ / W / Space / swipe up | jump (buffered: works slightly before landing) |
| ↓ / S / swipe down | slide; in the air: slam down |
| P / Esc / ⏸ | pause |

One swipe = one move: each swipe changes exactly one lane (or jumps / slides once), however long it is. Swipe again for the next lane.
Keys are matched by physical position (`event.code`), so WASD works on any keyboard layout (Ukrainian/Russian, AZERTY…). Holding a key never repeats a move.

- **Play Demo**: 3 districts (~2.5 min). The first run starts with a 3-row tutorial with on-screen prompts. A gate marks each district change, and the run ends in a golden-bull finale.
- **Bull Run (endless)**: speed ramps to a cap, districts cycle, ranked on the local leaderboard.

**Obstacles** (all collision boxes match the visible objects):
- **Rug pull**: a nice rug in your lane gets yanked away about 20 m before you reach it, revealing a pit. Jump or switch lanes.
- **Fake airdrop**: "FREE $HB" crates parachute in, then flip to **SCAM ☠** as they land. Jump them (you can land on top) or dodge.
- **Market crash**: red candles; dodge only. **DUMP** candles slide toward you, with a red alarm tint and a "WHO SOLD?!" moment.
- **FUD** barrier (jump) and **Liquidation line** laser (slide).
- **Liq**: clipping something from the side (or just the edge of a barrier mid-lane-change) is a stumble. Liq closes in for 7 s, with a heartbeat and a "LIQ ON YOUR TAIL" bar. A second stumble in that window and you're liquidated.

**Power-ups**: 💎 Diamond Hands (survive one hit, including a rug), 🧲 HODL Magnet, 2X Leverage, 👀 Eazy's Intel (green arrows over danger). Rare **$HB bags** (worth 10) sit on top of crates.

## Design notes

- **Fair generation** (`src/logic.js`): every obstacle row is checked against the previous one. From every lane the player could be in, a safe lane must be reachable in time at the current speed (lane-change time + 0.4 s reaction + moving-candle margin). Unit-tested over 20k+ rows per speed.
- **Coins**: ~15 per 100 m (was ~30), min. 3.2 m spacing. Patterns are short same-lane trails, 6-coin combo trails, arcs sized to the real jump over FUD/crates, and slide rows under laser lines. They are validated against obstacle volumes so they never sit inside geometry.
- **Coin audio** (`src/audio.js`): pickups go through a combo coalescer (130 ms cooldown, 0.75 s combo window). Combos climb a C-major pentatonic capped at E6, with ×10 milestones and a slight volume taper. All SFX run through a lowpass + compressor bus with a voice cap.
- **Timing** (`src/anim.js` `FixedStepper`): fixed 60 Hz simulation with bounded catch-up (max 0.1 s / 6 steps per frame; a resumed tab never fast-forwards). Rendering extrapolates by the leftover fraction of a step, so motion is smooth at 60/120/144 Hz while collisions stay on the fixed step.
- **Lane changes** (`LaneMotion`): cubic ease-in/ease-out with velocity continuity. Re-pressing mid-move continues smoothly, and reversing brakes instead of snapping. The total time is still 0.15 s per lane, and collisions use this exact position, so fairness is unchanged.
- **Naz animation** (`NazAnimator`): layered procedural poses (ride / air / slide / victory / idle) blended by smoothed weights, plus springs for lean, board bank, tail follow-through and squash, and short envelopes for takeoff, landing, hits, pickups and power-ups (the board does a 360). The board is placed under the feet from leg kinematics, and the slide pose keeps the head under the 1.12 m laser (unit-tested).
- **Camera**: springs instead of random shake. Restrained impact dips, a small lead and roll into lane changes, FOV breathing with speed. `prefers-reduced-motion` turns kicks, roll and FOV breathing off.

## Where to tweak

- `src/config.js`: districts (length, speed, obstacle weights, colors), power-ups, all dialogue.
- `src/logic.js`: fairness rules, coin patterns, coin-audio combo rules (pure, unit-tested).
- `src/anim.js`: lane motion, springs, fixed-step clock, Naz pose layers (pure, unit-tested).
- `src/models.js`: Naz / Eazy / Liq rigs, obstacles, gates, bull.
- `src/scenery.js` + `src/instancing.js`: instanced street scenery (buildings, lamps, walls, roads).
- `src/quality.js`: quality presets + adaptive controller.
- `src/main.js`: game loop, spawning, collisions, camera, finale.
- `src/audio.js`, `src/effects.js`, `src/ui.js`: sound, particles/trail, DOM HUD + menus + local leaderboard.

## Performance

- **Scrolling world**: road, scenery, obstacles, coins and gates sit at fixed positions inside one `world` group, and only that group moves. Static scenery is never touched per frame.
- **Instancing**: buildings (window UVs derived in a small shader patch, so one material per district), neon trims, lamps, glows, sandbag walls, coin piles, road segments and coins are `InstancedMesh` pools. Matrices are written only on spawn and despawn (coins update their spin per frame).
- **Characters**: untextured parts are folded into vertex colours per animated joint. Naz went from 62 to 45 draw calls, Eazy from 24 to 10, Liq from 15 to 9.
- **Obstacles**: the static parts of rugs, airdrops and DUMP candles are baked, cutting their draw calls by about 60%. Sparks are one instanced draw with a hard cap of 64.
- **Lighting**: no shadow maps anywhere and three lights total. Bloom is desktop-only and quality-dependent.
- **Quality** (menu or pause, "⚙ GRAPHICS"): Auto / High / Balanced / Performance changes the pixel ratio (capped by a pixel budget, so 4K screens don't render 4K buffers), bloom and decorative particle density. In Auto, the game steps down only after two sustained 3 s windows over 20 ms, and steps up at most once per session. Gameplay is never affected.
- **Pre-warming**: every template, shader and texture is built and compiled at boot, so district changes and first-time obstacles don't hitch.

Measured with `npm run sim:bench` (the real game loop in Node with a stub renderer; JS CPU per frame plus three.js-equivalent frustum-culled draw-call estimate, same seed before and after). Results are in `tools/bench/*.json`. This does **not** measure GPU time or real FPS.

| Scenario | Draw calls | CPU / frame avg (ms) | CPU p95 (ms) |
|---|---|---|---|
| Menu | 90 → 61 | 0.41 → 0.26 | 0.88 → 0.40 |
| Gameplay, The Hood | 416 → 87 | 0.86 → 0.52 | 1.75 → 1.14 |
| Busy Bull City | 431 → 92 | 1.00 → 0.50 | 2.00 → 1.00 |
| Magnet + many coins | 461 → 126 | 1.03 → 0.53 | 2.47 → 1.03 |
| District transition | 408 → 101 | 0.70 → 0.52 | 1.44 → 0.98 |
| 120 s endless (range) | 391–589 → 100–152 | 0.69 → 0.33 | worst frame 12.4 → 5.0 |

Bloom adds about 12 full-screen passes on top of these numbers on desktop High/Balanced.

Debug from the browser console: `__hb.startRun('story', 2)` jumps to Bull City (practice, unranked), `__hb.G` is the live state, and `__hb.perf` / `__hb.info()` show draw calls and frame cost.

## Manual playtest checklist

1. Menu: Naz waves on the right (desktop). Type a name, then Play Demo.
2. Tutorial: JUMP / SLIDE / SWITCH LANE prompts appear once each; you survive all three.
3. Coins: trails are readable, and long trails sound like a rising melody, not a buzz.
4. Hit a crate's side while changing lanes: stumble, Liq appears on the right, heartbeat, bar counts down.
5. Watch a rug get pulled, an airdrop flip to SCAM, and a DUMP candle (Trenches/Bull City).
6. Pick up each power-up; the chip timers count down and expire.
7. Reach Bull City's golden bull: finale, then the victory card. Check the leaderboard entry.
8. Die in district 2 or 3: "Continue from …" (practice) and "Run it back" both work.
9. Pause (P / ⏸), switch tabs (auto-pause), resume. Mute persists after reload.
10. On a phone: swipes (including fast double swipes), no page scroll, portrait and landscape.
11. Feel: lane changes ease in and out with a lean, bank and tail swing. Jumps compress, ollie and land with a squash. Slides go low under the laser, and the board stays under Naz's feet.
12. Switch the OS keyboard to a non-Latin layout (e.g. Ukrainian) and steer with WASD. Then type a name in the menu field and confirm the letters don't move Naz.
13. Watch an airdrop land: the canopy deflates onto the crate and disappears, and the crate stays and still blocks the lane.
14. Open `/?perf` for the dev overlay (fps, frame avg/p95, sim/render ms, draw calls). Try each ⚙ GRAPHICS level and a 144 Hz monitor if available.
