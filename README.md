# BasePinball

A browser-based 3D pinball game scored like baseball. Planning docs live in [docs/MVP](docs/MVP/README.md).

**Current milestone:** M0, foundations and physics spike. See the [M0 report](docs/MVP/m0-report.md).

## Develop

Requires Node 20.19+.

```bash
npm install
npm run dev          # physics sandbox at http://localhost:5173 (?webgl forces the WebGL2 backend)
npm test             # physics feel suite + unit tests
npm run bench:rapier # reference comparison against Rapier
npm run build        # typecheck + production build to dist/
```

## Layout

| Path | Contents |
|------|----------|
| `src/physics` | Custom pinball physics engine (fixed 1 kHz step, deterministic) |
| `src/table` | Table definitions (data-driven geometry and devices) |
| `src/render` | Three.js WebGPU renderer (WebGL2 fallback) and table meshes |
| `src/app`, `src/input`, `src/debug` | Fixed-step loop, timestamped input, tuning panel |
| `tests/physics` | Feel suite: tunneling, energy, cradle, flipper shots, devices, performance |
