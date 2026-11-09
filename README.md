# GreenFN

**1v1 basketball under the lights.** First to 11, ones and twos, make it take it.
A complete 3D browser game built with Three.js: procedural athletes with IK-driven animation,
a real basketball physics simulation, eight dribble moves, timed jump shots, an AI opponent,
and a cosmetic shop / progression loop. No build step, no external assets.

## Play

Open `index.html` through any static web server (or GitHub Pages, below). The game needs a
WebGL 2 capable browser (current Chrome, Edge, Firefox or Safari).

```bash
npm run serve
```

Then visit `http://localhost:8080/`.

### Controls

| Offense | Keyboard |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Sprint | `Shift` |
| Shoot — hold, release at the top of the jump | `Space` |
| Pump fake | tap `Space` |
| Layup (drive + shoot near the rim) · Dunk (sprint + shoot on an open drive) | `Space` / `Shift`+`Space` |
| Crossover · Between the legs · Behind the back | `J` · `K` · `L` |
| Spin · Hesitation · Stepback | `U` · `I` · `O` |
| Quick first step · Change of pace | `H` · `N` |
| Celebrate after a bucket | `T` |

| Defense | Keyboard |
| --- | --- |
| Slide / move | `W` `A` `S` `D` |
| Sprint (turn and run) | `Shift` |
| Steal | `J` |
| Jump · contest · block · rebound | `Space` |

General: `Esc` pause, `C` camera view, `M` mute, `R` reset (practice), `F3` FPS counter, mouse drag to orbit.
Gamepads are supported (left stick, `RT` sprint, `A` shoot, face buttons and right-stick flicks for moves).

### Rules

* Baskets inside the arc are worth 1, beyond the arc 2. First to 11 (configurable 7/11/15/21).
* Make it, take it: the scorer keeps the ball and checks it at the top.
* After a defensive rebound or steal the ball must be cleared beyond the arc before a basket counts.
* 24-second shot clock (resets when a shot hits the rim), out of bounds, goaltending.

## Deploying to GitHub Pages

The site is fully static (vendored Three.js, local fonts, synthesized audio), so no build is needed.

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Source: Deploy from a branch**.
4. Pick the branch that contains the game (for example `main`, or `claude/modest-tesla-poay3n`)
   and the **/ (root)** folder, then **Save**.
5. After a minute the game is live at `https://<user>.github.io/<repo>/`.

`.nojekyll` is included so GitHub serves every file as-is.

## Project structure

```
index.html            entry page + import map (three -> vendor/three)
css/main.css          UI design system
src/
  main.js / app.js    boot, fixed-timestep loop (120 Hz sim, interpolated rendering), mode flow
  core/               math (springs, easing, RNG), events, keyboard/gamepad input
  sim/                simulation (no DOM): ball physics, rig + IK, gait, animator, athlete movement,
                      dribble controller, moves, shooting, layups/dunks, defense, AI, rules, emotes
  render/             renderer + post FX, arena/court shader, characters, ball, hoop/net, camera, effects
  audio/              procedural Web Audio synthesis and event bindings
  meta/               cosmetic catalog, profile (save, currency, XP, quests, achievements)
  ui/                 menu dashboard, panels, HUD, end screen
vendor/three/         Three.js r187 (minified) + used addons
assets/fonts/         Barlow / Barlow Condensed (SIL OFL)
tests/                Node simulation tests + Playwright browser checks
tools/serve.mjs       tiny static server
```

### How the core systems work

* **Ball physics** — semi-implicit integration at 240 Hz with quadratic drag, Magnus lift and spin;
  impulse collisions with friction against the floor, the rim (torus), backboard, stanchion and
  player bodies; a damping net; geometric "through the ring from above" score detection.
* **Shooting** — the shot never follows a canned path. Release timing, distance, skill, contest,
  movement and fatigue produce an aim error at the rim; a solver finds the real launch velocity and
  the physics decides make or miss. Calibrated with `tests/shotcal.mjs`.
* **Dribbling** — the ball is genuinely simulated between hand and floor. The release velocity is
  solved so one real bounce returns it to where the receiving hand will be; limited steering
  compensates for direction changes; Hermite paths keep the palm on the ball during contact.
* **Animation** — a procedural rig: world-locked foot plants with predictive placement (no
  sliding), defensive shuffles that never cross the feet, toe/heel pivots, a pelvis that drops to
  keep legs reachable, a spine that leans into acceleration, head look-at, and spring-blended arm
  layers solved with hinge-correct two-bone IK.
* **AI** — drives the same intent interface as the player (same physics and limits), perceives
  through a reaction-delay buffer, can be faked out, and picks shots by expected points.

## Tests

```bash
npm install            # three, for running the simulation in Node
npm test               # full headless suite (below, with assertions)
node tests/moves.test.mjs      # every dribble move executes, switches hands, keeps the dribble
node tests/shotcal.mjs 300     # Monte Carlo make rates by distance / release / contest
node tests/aivai.mjs pro pro 3 # full AI-vs-AI games through the real rules
node tests/sim-dribble.mjs     # 60 s of random direction changes without losing the ball
```

Browser checks use the pre-installed Playwright Chromium (`tests/e2e/*.mjs`) with
`window.__gfn.simulate(seconds)` for deterministic stepping.

## Credits

Code and procedural assets: GreenFN. Three.js (MIT). Barlow fonts by Jeremy Tribby (SIL OFL 1.1).
