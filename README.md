# Atlas Forge

Atlas Forge is a deterministic browser-based fantasy world generator focused on strong continent silhouettes and readable satellite-style relief. It runs entirely on the user's machine and requires no account or server API.

## Current milestone

- Poisson-disc sampling, Delaunay graph simulation, and weighted Voronoi plates
- Hierarchical continental provinces arranged around a deliberate major ocean basin
- Unequal dominant, secondary, and satellite systems without an explicit continent-count control
- Broad cratonic cores with sparse arms, compactness scoring, and size hierarchy
- Branching variable-width rifts, nested gulfs, inland basins, detached fragments, and island chains
- Seamless 360° longitude with continent systems allowed to cross the atlas seam
- Naturally nucleated coherent continental systems instead of a requested continent count
- Seeded oceanic convergence that can raise discontinuous tectonic island arcs
- A denser irregular simulation mesh and smoother multiscale relief
- Five-candidate composition scoring for open ocean, compactness, hierarchy, coast complexity, and component range
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
- Memory-bounded 4096 × 2048 and 8192 × 4096 cartographic exports with export-scale shoreline detail

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

This is the seventh continent-and-satellite checkpoint. It adds an aesthetic world-composition layer above the tectonic model: continental systems cluster into unequal provinces around an intentional open ocean, while global sea level still cuts one reusable continuous height field. The retained model can be rerendered at 4K or 8K without rebuilding plates, drainage, and full-resolution float fields. Political borders, settlements, labels, authored regional editing, true polar graph topology, and full hydraulic erosion remain intentionally deferred until the base geography is consistently attractive.
