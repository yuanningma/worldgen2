# Atlas Forge

Atlas Forge is a deterministic browser-based fantasy world generator focused on strong continent silhouettes and readable satellite-style relief. It runs entirely on the user's machine and requires no account or server API.

## Current milestone

- Poisson-disc sampling, Delaunay graph simulation, and weighted Voronoi plates
- Directional terrane networks with curved continental arms and narrow isthmuses
- Branching variable-width rifts, nested gulfs, inland basins, detached fragments, and island chains
- Seamless 360° longitude with continent systems allowed to cross the atlas seam
- Naturally nucleated coherent continental systems instead of a requested continent count
- Seeded oceanic convergence that can raise discontinuous tectonic island arcs
- A denser irregular simulation mesh and smoother multiscale relief
- Five-candidate composition scoring with separate structural mass and global sea-level controls
- Exact Euclidean signed-distance coastlines with domain warp and five-scale fractal detail
- A bounded Donjon-inspired spherical fault residual near the coast
- Explicit seeded peninsulas, bays, straits, and near-coast islands
- Convergent mountain envelopes with high-resolution folded relief
- Graph Priority-Flood drainage and moisture-weighted river accumulation
- Smoothed, antialiased, continuously scaled river rendering
- Coverage-aware shores, dynamic mountain color classes, and multiscale hillshade
- Satellite and field-ink interpretations from the same world model
- Draggable orthographic globe and seamless equirectangular atlas views
- Preview, High, and Ultra resolution tiers with resolution-stable geography
- Reproducible controls, zoom, PNG export, and responsive Web Worker generation
- Memory-bounded 8192 × 4096 cartographic export with export-scale shoreline detail

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validate

```bash
npm run typecheck
npm test
npm run lint
```

The implementation and research-informed product decisions are documented in [DESIGN.md](./DESIGN.md).

## Project status

This is the sixth continent-and-satellite checkpoint. It formalizes the generator as a reusable height model: plate spacing, motion, and continental mass naturally nucleate a bounded set of cratons; global sea level cuts that field independently; and an 8K strip renderer adds fine shoreline detail without simulating dozens of full-resolution fields. Political borders, settlements, labels, authored regional editing, true polar graph topology, and full hydraulic erosion remain intentionally deferred until the base geography is consistently attractive.
