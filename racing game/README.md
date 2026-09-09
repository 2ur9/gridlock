# School Racing Sim

A browser racing simulator for classroom use. Sim-style handling (weight transfer, slip-curve tyres,
friction circle, aero, surface grip), six real-inspired circuits, Formula and GT disciplines, AI grids with
four difficulty levels, qualifying-style time trial with ghost laps, a data-driven career season, flags,
static wet/dry weather, procedural engine/tyre/impact sound, five cameras (cockpit with a working wheel,
dash and live rear-view mirror), class-code student accounts, and room-code multiplayer.

Everything runs from **one Render web service**: it serves the client, runs the Socket.IO multiplayer
server, and talks to a Neon Postgres database. Push to GitHub → Render redeploys.

```
client/index.html   the page + HUD + menus (no build step, plain static files)
client/game.js      physics, AI, race logic, cameras, HUD, persistence, netcode
client/world.js     visuals: sky/lighting, terrain, trackside scenery, car models, cockpit
server/index.js     Express static + REST + Socket.IO bootstrap
server/api.js       class codes, login, profile, lap submission, leaderboards
server/rooms.js     room-code lobbies + race state relay
server/db.js        Neon Postgres (falls back to in-memory if DATABASE_URL is unset)
render.yaml         one-click Render blueprint
```

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | throttle |
| `↓` / `S` | brake / reverse |
| `←` `→` / `A` `D` | steer |
| `Space` | handbrake |
| `C` | cycle camera: Chase → Cockpit → Hood → TV Broadcast → Trackside free cam |
| `R` | recover the car back onto the track |
| `M` | sound on / off (**off by default**) |
| `Esc` / `P` | pause menu |

Free cam (spectators / trackside view): `W A S D` move, arrows look, `Q`/`E` down/up.

Steering assist (Settings) is on by default — it caps steering lock at what the tyres can use at your current
speed and adds traction/stability control, which is what makes full-lock keyboard input drivable.

## Deploy (about 10 minutes, all free tiers)

### 1. Database — Neon
1. Create a project at [neon.tech](https://neon.tech).
2. Open *Connection Details*, choose the **pooled** connection string, tick *Include password*.
3. Copy it — it looks like `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.

(You can skip this step: without `DATABASE_URL` the server keeps accounts/leaderboards in memory, which
resets on every restart. Fine for a first try, not for a term.)

### 2. Code — GitHub
```bash
git init && git add -A && git commit -m "School Racing Sim"
```
Then create a repo on GitHub and push (`git remote add origin … && git push -u origin main`).

### 3. Host — Render
1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → connect the repo.
   Render reads `render.yaml` and creates the web service.
2. When prompted for environment variables, paste your Neon string as `DATABASE_URL`.
   Optionally set `TEACHER_KEY` to a secret word — then only someone who knows it can create class codes.
3. Deploy. Your game is at `https://<service-name>.onrender.com`.

Every later `git push` redeploys automatically.

**Free-tier note:** the service sleeps after ~15 min idle and takes 20–40 s to wake. Open the URL a couple
of minutes before class. If that becomes annoying, Render's Starter tier (~$7/mo) removes the sleep.

### 4. First run
1. Open the site → **Profile** → expand *Teacher — create a class code* → e.g. `RACE-7B`.
2. Students open the site → **Profile** → pick the class code, type their name → **Log in**.
   Best laps, livery and career progress now follow them across devices.
3. Multiplayer: one person (the teacher works well) → **Multiplayer → Create room** → reads out the 4-letter
   code. Everyone else types the code and their name → **Join** (or *Join as spectator*). Host presses
   **Start race**. No account needed to join a room.

## Local development

Node ≥ 18 is required for the server (`brew install node` on macOS).

```bash
cp .env.example .env      # optional: add your DATABASE_URL
npm install
npm run dev               # http://localhost:8080  (client + API + multiplayer)
npm test                  # server unit tests
```

Single-player also works with **no server at all**: serve the `client/` folder with any static server
(`python3 -m http.server 8137` inside `client/`) — accounts and multiplayer are disabled in that mode.
Opening `index.html` directly from disk does not work because browsers block ES modules on `file://`.

## How it's built

**Physics** (`Vehicle` in `game.js`) — a single-body model stepped at 120 Hz: analytic ground following the
track spline (elevation + banking), per-axle vertical load with longitudinal weight transfer, a slip-angle
tyre curve with a peak and progressive fall-off (separate Formula/GT curves), a friction circle so braking or
driving eats lateral grip, a traction limit at the driven axle, speed² downforce and drag (DRS drops drag),
surface grip zones (tarmac / kerb / grass / gravel), tyre wear and fuel. All constants are in `CARS`, `TYRE`,
`MODES` at the top of `game.js` — tune there, not in the physics code.

**Tracks** (`TRACK_DEFS`) — control points `[x, z, width, banking, elevation]` through a closed Catmull-Rom
spline, sampled every ~4 m. From the samples the game derives the racing line, per-point target speeds
(with a backward braking pass), sector splits, DRS zones, gravel traps, the barrier line, and TV camera
spots. Layouts are modelled from public knowledge of each circuit's corner sequence at roughly half scale —
no scanned or game-extracted data. Add a track by adding an entry; nothing else changes.

The six circuits: a training oval, Monza (straights + chicanes), Spa (elevation, Eau Rouge, La Source),
Silverstone (flowing esses), Nurburgring GP (technical), and **Alpenring** - a power circuit with three
very long climbing/descending straights and only six corners, the highest average speed of the set.

**Scenery** (`world.js`) — a heightfield terrain that follows track elevation, procedural grass/asphalt/gravel
textures with normal maps, kerbs, edge lines, armco with posts, catch fencing, tyre walls on the tight
corners, advertising boards, brake markers, three grandstands with instanced crowds, a pit complex, a bridge,
marshal huts, light and TV towers, thousands of billboard trees and bushes, distant hills, and a physical
sky with the sun position driving both lighting and reflections. Quality (Settings) scales instance counts,
shadow resolution and the mirror.

**Cars** — the GT uses the sample car model shipped with the three.js examples (Ferrari 458 by
vicent091036, Creative Commons attribution), loaded from the jsDelivr CDN, recoloured to each livery, with
its real interior and steering wheel used for the cockpit view. If the model can't be fetched (offline) a
procedural GT is built instead. The Formula car is fully procedural (rounded-box tub, wings with a moving DRS
flap, halo, suspension, compound-coloured tyre bands).

**AI** — pure-pursuit steering on the racing line, target speed from curvature with a braking look-ahead;
difficulty scales pace, aggression (overtake/defend nudges), and mistake rate. Stuck cars auto-recover.

**Multiplayer** (`server/rooms.js`) — rooms live in memory keyed by a 4-letter code. Each player's car is
simulated in their own browser; the server collects everyone's state and rebroadcasts one snapshot at 20 Hz;
clients interpolate remote cars. The host's browser also simulates the AI grid and sends it along. The
server is authoritative for the lobby, the start sequence, the race clock, lap/standings bookkeeping,
flags, and it clamps impossible speeds. This keeps the netcode small and robust for a school network;
true server-side collisions would need a shared physics step (see "Not in v1").

**Accounts** — class code + name, no passwords (a classroom-trust model). Profiles store livery, career
progress and best laps; the leaderboard is per track/discipline. Guests get the same features in
`localStorage` on that browser only.

## Not in v1 (by design)

- Replay/playback system.
- Damage model beyond momentum-scrubbing collisions (no crumple, no mechanical damage, no DNF).
- Dynamic mid-race weather (wet/dry is a per-race setting).
- Server-side collision resolution between players.
- Real laser-scanned circuits — the layouts are inspired approximations.

## Tuning after the first playtest

- Sound is off until the player presses `M` or ticks Sound in Settings (`Audio.muted`).
- Handling feel: `CARS.*` (mass, `frontBias`, `cgH`, `maxSteer`, `brakeForce`, `aeroDown`, `dragCoef`)
  and `TYRE.*` (`peakSlip`, `muPeak`, `falloff`).
- AI pace: `DIFF.*.pace` is a multiplier on the track's target speeds; `latAccel`/`brakeDecel` in the
  `Track` constructor set what the AI thinks the car can do.
- Lap-time sanity floors for the leaderboard: `LAP_FLOOR` in `server/api.js`.
