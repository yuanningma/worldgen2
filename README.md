# Atlas Forge

Atlas Forge is a deterministic browser-based fantasy world generator focused on strong continent silhouettes and readable satellite-style relief. It runs entirely on the user's machine and requires no account or server API.

## Current milestone

- Poisson-disc sampling, Delaunay graph simulation, and weighted Voronoi plates
- Hierarchical continental provinces arranged around a deliberate major ocean basin
- Unequal dominant, secondary, and satellite systems without an explicit continent-count control
- Distorted anisotropic cratonic masses with sparse arms, compactness scoring, and size hierarchy
- Branching variable-width rifts, nested gulfs, inland basins, detached fragments, and island chains
- Seamless 360° longitude with continent systems allowed to cross the atlas seam
- Naturally nucleated coherent continental systems instead of a requested continent count
- Seeded oceanic convergence that can raise discontinuous tectonic island arcs
- A denser irregular simulation mesh and smoother multiscale relief
- Five-candidate composition scoring for open ocean, compactness, hierarchy, coast complexity, and component range
- Exact Euclidean signed-distance coastlines with domain warp and five-scale fractal detail
- A bounded Donjon-inspired spherical fault residual near the coast
- Explicit seeded peninsulas, bays, straits, and near-coast islands
- Segmented convergent mountain cores with narrower foothill envelopes
- Graph Priority-Flood drainage and moisture-weighted river accumulation
- Smoothed, antialiased, continuously scaled river rendering
- Coverage-aware shores, dynamic mountain color classes, and multiscale hillshade
- Satellite, field-ink, and categorical climate/topographic atlas interpretations from the same world model
- Draggable orthographic globe and seamless equirectangular atlas views
- Preview, High, and Ultra resolution tiers with resolution-stable geography
- Reproducible controls, zoom, optional PNG download, and responsive Web Worker generation
- Persistent in-browser 4096 × 2048 and 8192 × 4096 atlases with render-scale shoreline detail

## Tectonic simulator prototype

The replacement geology core is being developed separately from the current visual generator under `lib/tectonics/`, `lib/spherical/`, and `lib/evaluation/`. It now generates deterministic whole-sphere prototype worlds with:

- a closed subdivided icosphere with exact spherical areas;
- plate domains, Euler-pole boundary kinematics, and persistent boundary history;
- persistent continental and oceanic crust state with age, thickness, density, provenance, uplift, rifting, and arc accretion;
- persistent Lagrangian parcel IDs, exact Euler advection, and conservative local capacitated-flow remapping with explicit gap/overlap and transport-distance diagnostics;
- an opt-in coupled finite-volume history where plate mixtures, fractional continental material, provenance, relief, and deformation memory cross only adjacent geodesic edges and feed back into the next tectonic step;
- isostatic elevation, age-dependent ocean depth, and one area-weighted canonical sea level shared by every projection;
- plate-aware irregular continental graph growth without a user-facing continent-count control;
- spherical hard gates for ribbons, isthmuses, gulfs, lakes, elongation, canonical border stability, and multiscale coastline richness;
- deterministic multi-seed evaluation and accepted-only ranking;
- exact scientific and smoothed presentation atlas renderers;
- a persistent nested geodesic surface-process grid with topology-safe coast refinement, geology-conditioned relief, latitude-aware precipitation, conservative runoff, Priority-Flood drainage, resolved river networks, bounded stream-power incision, and conservative downstream sediment transfer.

Generate and evaluate worlds without starting or deploying the web app:

```bash
npm run debug:tectonics -- --seed=RIFT-02 --subdivisions=3 --plates=8
npm run evaluate:tectonics -- --seeds=ATLAS-A,ATLAS-B,ATLAS-C --subdivisions=4
npm run evaluate:tectonics -- --seeds=ATLAS-A,ATLAS-B,ATLAS-C --subdivisions=5 --moving-myr=2
npm run evaluate:tectonics -- --model=coupled --history-myr=120 --seeds=ATLAS-A,ATLAS-B --subdivisions=5
npm run render:tectonic-surface -- --model=coupled --history-myr=120 --seed=ATLAS-A --subdivisions=5
npm run render:tectonic-atlas -- --seed=ATLAS-A --subdivisions=5 --output=outputs/tectonics/world.png
npm run render:tectonic-candidates -- --seeds=ATLAS-A,ATLAS-B,ATLAS-C,ATLAS-D
npm run render:tectonic-surface -- --seed=ATLAS-A --subdivisions=5
npm run render:surface-process -- --model=coupled --seed=ATLAS-A --subdivisions=5 --surface-subdivisions=6
```

The implementation roadmap is in [the comprehensive simulator plan](./docs/COMPREHENSIVE_WORLD_SIMULATOR_PLAN.md). The fixed history remains the stable reference, and `simulateMovingCrustSnapshot` remains the exact parcel-remap conformance path. `simulateCoupledTectonicWorld` is the first feedback model: an explicit finite-volume step transports material only across adjacent spherical faces, retains fractional continental and plate mixtures, feeds moved state into later rifting/collision, reports ridge-creation and subduction budgets, and applies area-preserving VOF interface compression to limit long-horizon diffusion. The evaluator rejects nonlocal parcel transport, fine-only coast noise, insufficient continent hierarchy, oversized dominant landmasses, polar land concentration, and near-circumpolar zonal belts. `createSurfaceProcessWorld` promotes an accepted tectonic state to a nested spherical process mesh and derives a closed drainage graph without changing canonical topology. Climate is currently a reduced latitude/elevation precipitation field, not atmospheric circulation. The first geomorphic pass carves resolved channels, deposits sediment in low-gradient and terminal reaches, and closes its sediment budget, but it does not yet model time-varying climate, lithology, hillslope diffusion, flexural/isostatic feedback, lakes, or dynamic deltas. The coupled model also still lacks persistent parcel identities through creation/destruction, overlap-area remapping, and plate splits/mergers.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validate

```bash
npm run typecheck
npm run test:tectonics
npm test
npm run lint
```

The implementation and research-informed product decisions are documented in [DESIGN.md](./DESIGN.md).

## Project status

This is the eighth continent-and-atlas checkpoint. Broad distorted cratonic masses now keep continents cohesive at low exposed-land fractions, candidate selection checks high-sea-level stability, and coast complexity is measured across several scales instead of as one perimeter number. The retained model can be drawn directly into a persistent 4K or 8K browser atlas without rebuilding plates and drainage; downloading that view is optional. A new categorical climate/topographic style keeps terrain classes flat while using a separate segmented mountain mask. Political borders, settlements, labels, authored regional editing, true polar graph topology, and full hydraulic erosion remain intentionally deferred until the base geography is consistently attractive.
