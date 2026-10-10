# 03 — Physics

Realistic ball movement and interactions are the top technical priority. This document sets out the
physics approach, the model, and how we will check that it *feels* right.

## 1. Decision: a custom pinball physics engine

We will write a **purpose-built pinball physics engine in TypeScript**, running at a **fixed 1000 Hz
step** (tunable 500–2000 Hz). We will not use a general-purpose rigid-body engine.

### Why not Rapier, Havok, Ammo or cannon-es?

| Concern | General engine | Custom pinball engine |
|---------|----------------|-----------------------|
| Flipper ↔ ball | The flipper is a kinematic body (infinite mass) or a jointed motor. Catches, cradles, post passes and dampening come out inconsistent and are hard to tune. | The flipper is modelled as a rotating body with finite inertia driven by coil torque. Energy exchange on impact is what allows live catches and dampening. |
| Rubber | A single constant restitution value | **Velocity-dependent restitution** (rubbers are bouncy at low speed and deaden at high speed), which is key to pinball feel |
| Tunneling at 1 kHz | Continuous collision detection (CCD) exists but is tuned for general cases. Seams between mesh triangles create "ghost" bumps. | Analytic primitives (no triangle seams on the playfield or walls) plus swept-sphere time-of-impact tests |
| Rolling, spin, friction | Generic contact model | Explicit rolling vs sliding transitions, spin transfer, and rolling resistance tuned for a steel ball on clear-coat |
| Determinism | Varies (Rapier offers deterministic builds) | Fully under our control: needed for replays, the headless sim bot, and future leaderboard validation |
| Payload | 400 KB – 1.5 MB WASM | Small. We only need sphere-vs-primitive collisions. |
| Cost | Fast to start | More upfront work. The scope is narrow (only balls are dynamic), and the approach is well understood from the pinball-simulation community. |

**Prior art:** Visual Pinball X (VPX) shows that a specialised ~1 kHz pinball solver produces
excellent feel. VPX is GPL-licensed. We may study its published concepts and community tuning
values, but **no code will be copied.**

**Risk control:** the first milestone (M0) is a **physics spike**. It builds the core (slope, walls,
posts, two flippers, sling, pop bumper, fielder saucer) and runs the feel tests in § 9. If the custom
engine cannot reach the feel bar within the spike, we fall back to Rapier with a custom flipper and
rubber layer. Rapier is also benchmarked during the spike as a reference.

## 2. World model

- **Dynamic bodies:** balls only (1 in the MVP; the engine supports N for future multiball).
- **Everything else** is static or kinematic, expressed as analytic collider primitives built from the
  table definition.
- **Space:** fully 3D, with the playfield as a tilted plane. Gravity is applied in world space, and the
  playfield is tilted by the slope angle. Ramps and wireforms are true 3D.

### 2.1 Collider primitives

| Primitive | Used for |
|-----------|----------|
| `Plane` (bounded polygon) | Playfield surface, ramp floors, apron, glass ceiling |
| `Segment` (2D line, with z extent) | Guide walls, lane guides, ramp side walls |
| `Arc` (with z extent) | Top arch, orbit curves, rounded walls |
| `Cylinder` | Posts, pop bumper bodies, pitcher post, standee bases |
| `RubberRing` (cylinder/segment set with rubber material) | Rubbers stretched around posts (generated from post layout) |
| `Capsule` / `TubePath` | Wireforms (chains of capsules along a spline) |
| `Dish` (spherical cap or torus profile) | Fielder saucers, mound hump, mound cup |
| `TriMesh` | Complex ramp transitions only, with a seam-free welded-normal option |
| `Flipper` | Rotating rounded trapezoid (two circles + two tangent segments), with angular state |
| `Gate` / `Spinner` | Hinged plates (one-way gates, HR gate) |
| `Sensor` | Rollover switches, optos, outlane/drain zones (no collision response) |

### 2.2 Materials

Each collider has a **material** with: restitution curve `e(v)`, friction μ, rolling resistance, and
an optional "dampening on high impact" factor. Starting materials: `playfield`, `wood`, `metal`,
`plastic`, `rubber_post`, `rubber_sling`, `rubber_flipper`, `pop_bumper`, `glass`.

## 3. Ball dynamics

- **State:** position, linear velocity, angular velocity (spin), and orientation (quaternion, so the
  renderer can show spin).
- **Body:** a solid steel sphere with inertia I = 2/5 · m · r².
- **Gravity along the slope:** g · sin(6.5°) ≈ **1.11 m/s²**.
- **Contact with a surface:** the ball moves to the contact point, a normal impulse is applied with
  restitution `e(vₙ)`, and a tangential friction impulse (Coulomb-limited) changes both linear and
  angular velocity. This is what lets the ball **pick up spin, skid, then roll.**
- **Rolling:** when the contact-point velocity is ≈ 0, the ball is in rolling mode. A small rolling
  resistance applies. Sliding friction applies otherwise.
- **Resting contact:** stabilised so the ball does not jitter on the playfield, in dishes, or cradled
  on a flipper (this has an explicit test).
- **Speed cap:** 20 m/s, a safety net only. Normal play peaks around 8–10 m/s.

## 4. Flippers

Flippers are the most important objects in the game.

- **Model:** a rigid body rotating about a fixed pivot, with **finite moment of inertia**, driven by a
  **coil torque** while the button is held. Return is by a spring torque. Stops are at the rest and
  end-of-stroke (EOS) angles. Hitting the stops uses a small restitution so the flipper bounces
  slightly, as real ones do.
- **Two-stage coil:** full power until EOS, then a weaker **hold** torque. This affects cradles and
  how hard a ball hitting a raised flipper bounces off it.
- **Contact:** uses the flipper's surface velocity at the contact point (ω × r) and its effective
  mass, so the ball slows a moving flipper slightly. This is required for realistic catches and
  dampening.
- **Stops are rigid:** a bat resting on a stop cannot be pushed further into it. A ball landing on
  a lowered flipper meets a rigid bat, and so does a ball pushing a held bat past its end of
  stroke. A ball hitting a held bat from above *can* push it down against the weaker hold torque.
- **Rubber:** the `rubber_flipper` material has a strong falloff in `e(v)` and high friction, which
  makes "dead" catches possible.
- **Tunables:** length, base and tip radius, mass/inertia, coil strength, hold strength, return
  strength, stroke angle (≈ 55°), rest angle, and EOS bounce.

**Feel targets** (the player must be able to perform all of these):

- **Cradle:** hold the ball still on a raised flipper.
- **Post pass:** let the ball bounce off one flipper over to the other.
- **Drop catch:** release a raised flipper so the ball settles into a cradle.
- **Live catch:** flip at the right moment to absorb an incoming ball's energy.
- **Tap pass:** a tiny flip to pass the ball between flippers.
- **Backhand shots** to the same side.
- **Bounce pass** off the rubber at the bottom of the stroke.

## 5. Other devices

| Device | Model |
|--------|-------|
| Slingshot | Rubber segment. When the switch closes (impact speed > threshold), the kicker applies an outward impulse for ~8 ms with a cooldown. |
| Pop bumper | Cylinder body. A skirt sensor triggers a ring impulse directed radially from the bumper center, with a minimum kick speed and cooldown. |
| Corner kicker | Rubber wall segment with a switch and a tangential + normal kick that keeps the orbit moving |
| Fielder saucer | `Dish` collider plus rubber back lip. A capture sensor checks the "settled" condition. |
| Drop target | A rigid plate that drops below the playfield when hit above a speed threshold. Its collider is disabled once down, and it resets on a coil command. |
| Standup target | A rubber-faced plate with a switch and slight compliance |
| Spinner | A thin plate on a horizontal axle with its own angular state and friction. The ball passing under it sets it spinning. Each revolution closes a switch. |
| Ramp entrance flap | Thin metal lip with a small step. Missed ramp shots rattle off it realistically. |
| Gates / HR gate | Hinged plate with its own angular state. Ball contact rotates it. One-way limits. Switch on passage. |
| Kickback / VUK / pitch kicker | Scripted impulses. The VUK teleports the ball into the mound cup (as a subway would). |
| Magnet (curveball) | A force toward or away from the magnet center, strength ∝ 1/(d² + ε), shaped over time by the pitch script |
| Plunger | Spring model: pull distance → stored energy → impulse into the ball, with a little randomness from a seeded generator |

## 6. Collision detection and stepping

- **Fixed step** of 1 ms, with an accumulator loop on the main thread. The renderer interpolates the
  ball between the last two physics states (position lerp, orientation slerp).
- **Adaptive substeps (as built in M0):** each 1 ms step is split so that neither the ball nor any
  point on a flipper moves more than **2 mm per substep** (up to 32 substeps). Every collider is at
  least a ball radius (13.5 mm) thick once the ball's radius is added, so an overlap test on each
  substep cannot tunnel, including against a fast-moving flipper. This replaced the planned
  time-of-impact sweeps: it is simpler, handles moving and static geometry the same way, and the
  tunneling tests pass at 20 m/s. Typical play needs 1–3 substeps.
- **Contacts** are resolved twice per substep with impulses, so a ball wedged between, say, a
  flipper and an inlane guide settles cleanly.
- **Broadphase:** a uniform grid of 50 mm cells. Collider bounds are padded by the ball radius, so
  looking up the ball centre's cell finds every possible contact. M0 has one level. Ramp and
  wireform layers will be added in M1.
- **Spiral-of-death guard:** at most 50 steps per rendered frame. If a frame takes longer, the
  backlog is dropped, so the simulation briefly runs slower instead of fast-forwarding. The clock
  resyncs when the tab becomes visible again.
- **Budget:** under 1 ms of CPU per 16 ms frame on a mid-range phone for 1 ball (≈ 17 steps).
  M0 measured **≈ 2 µs per step** in Node and **15–40 µs per frame** in desktop Chrome.

### 6.1 Threading

The engine starts on the **main thread** for the lowest input latency and simplest code. Its
interface (`step(inputs) → events + state`) is serialisable, so it can move into a Web Worker later
if the main thread gets busy. That move would not need `SharedArrayBuffer`, so no special headers.

## 7. Input timing

- Input events carry `event.timeStamp`. The loop converts them to simulation time and applies each
  one **at the exact 1 ms step** it belongs to. This avoids up to a frame of latency jitter, which
  matters for flipper timing.
- Flipper state changes are logged with their step index. Together with the random seed, this log is
  a **deterministic replay**.

## 8. Determinism

- **Same build + same seed + same input log → same game**, on the same JS engine.
- Randomness (plunger noise, pitch selection) comes only from a seeded generator (xoshiro128** or
  similar). The step never reads wall-clock time.
- **Cross-engine** determinism (V8 vs JavaScriptCore vs SpiderMonkey) is a *P2 goal*. It is needed if
  a Cloudflare Worker ever re-simulates a submitted game to validate a leaderboard score. The rule
  from day one makes this cheap later: the physics step must not call `Math.sin/cos/tan/exp/pow/atan2`
  and must use our deterministic implementations or precomputed tables. `+ − × ÷` and `Math.sqrt`
  give identical results in every engine (IEEE-754 correctly rounded).

## 9. Feel and validation suite

Automated tests run in Vitest, headless, and use deterministic scenarios:

1. **No tunneling:** fire balls at 2–20 m/s at every collider type, at many angles. The ball must
   never end up inside or past a collider.
2. **Energy sanity:** with no actuators firing, total energy never increases.
3. **Cradle stability:** a ball on a held flipper stays still for ≥ 10 s, with drift under 0.5 mm.
4. **Flipper shot repeatability:** the same contact point gives the same exit angle and speed. We
   also record curves of exit angle vs contact position (the shot map for tuning).
5. **Saucer capture curve:** capture probability vs incoming speed and angle for each saucer,
   compared against design targets.
6. **Ramp threshold:** the minimum entrance speed for a HR, and rollback below it.
7. **Pitch validation:** every pitch template reaches a flipper sweet zone. No template goes down
   the middle.
8. **Golden replays:** recorded games must reproduce identical outcome sequences after physics
   changes, unless a change deliberately updates them.

**Manual feel review:** each tuning session checks the targets in § 4. A debug panel allows live
parameter editing, time scaling (0.1×–1×), placing and dragging the ball, shot trails, and
contact-point readouts.

## 10. Starting parameters (to be tuned)

These are **starting guesses**. Real values come from feel tuning in M0/M1.

| Parameter | Start | Notes |
|-----------|-------|-------|
| Physics rate | 1000 Hz | 500–2000 |
| Slope | 6.5° | |
| Ball diameter / mass | 27 mm / 80 g | Real values |
| Flipper length | 80 mm | Modern flippers are ≈ 3–3⅛ in |
| Flipper stroke | 55° | |
| Flipper full-stroke time (unloaded) | ≈ 20–25 ms | M0 defaults: effective mass 0.1 kg, coil 1.1 N·m, hold 0.2 N·m, return 0.15 N·m. Shots from rest leave at 3.2–4.1 m/s. |
| Rubber `e(v)` | 0.85 at < 0.5 m/s → 0.55 at > 6 m/s | Flipper rubber is somewhat deader |
| Playfield `e` | 0.25 | The ball barely bounces on wood |
| Metal / wood wall `e` | 0.45 / 0.40 | |
| Ball–playfield friction μ | 0.15 sliding | Rolling resistance ≈ 0.001–0.005 |
| Pop bumper kick | ≈ 3.5 m/s exit | Minimum kick plus impact speed |
| Slingshot kick | ≈ 3.0 m/s | |
| Nudge impulse | ≈ 0.3 m/s cabinet displacement equivalent | Tilt bob threshold tuned against it |

## 11. Nudge and tilt model

- A nudge moves the cabinet briefly along a short impulse curve. The physics applies the
  corresponding pseudo-force to the ball (the frame moves under the ball). The camera shows a small,
  matching shake.
- A simulated **tilt bob** (a damped pendulum) receives the same impulse. Each time it swings past the
  contact radius, the player gets a warning. The third time is a TILT. Warnings decay over time.

## 12. As built in M1

What the whitebox added or changed, with the reasons:

- **Triangle and capsule colliders.** Ramps are triangle surfaces with side walls. Wireforms are
  six capsule rails around the ball's path (two below, one on each side, two above), with a flared
  entry. Triangles use the closest-point-on-triangle test, so a ball rolling across shared edges
  meets no ghost bumps.
- **Saucer skim.** Above `saucerSkimSpeed` (1.1 m/s) a ball skims over a saucer unless it has
  already dipped in. Modelling the dip with a sharp rim launched fast balls about 5 cm into the
  air. A real ball spans most of the hole and barely dips at speed. Visual Pinball's kickers take
  the same approach.
- **Pop bumpers** fire on any real press of the skirt, including a ball resting against them while
  wedged by a wall (otherwise it can stall there).
- **Orbit corner kickers:** the switch closes on any contact, and the boost (`kickerSpeed`) fires
  only above `kickerThreshold` (0.7 m/s approach). A gently plunged ball hugging the arch is not
  flung round the loop, which keeps the skill shot possible.
- **Smooth mound profile** z = h·(1 − (r/a)²)², flat-tangent at its rim. It is currently
  non-solid (visual only): even a 4 mm hump deflected centre shots.
- **Magnet:** a force toward its centre, fading linearly to zero at its reach, scaled by a power
  (0–1) that game logic sets for curveballs.
- **Plunger:** the pull builds over `plungerPullTime`. On release, a ball resting on the tip gets
  `pull × plungerMaxSpeed`, with ±1 % seeded variation.
- **Nudge and tilt bob:** a nudge adds `nudgeSpeed` to the ball and kicks a damped 2D pendulum.
  Crossing `tilt.warnRadius` emits a `tiltBob` event. Counting warnings into a TILT is a rules
  job (M2).
- **Determinism** now also covers `src/table`: table geometry feeds the physics, so the lint ban
  on `Math.sin/cos/hypot/…` applies there too.
- **Performance** on the full v1 table: ≈ 1.2 µs per step.

