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

This is the eighth continent-and-atlas checkpoint. Broad distorted cratonic masses now keep continents cohesive at low exposed-land fractions, candidate selection checks high-sea-level stability, and coast complexity is measured across several scales instead of as one perimeter number. The retained model can be drawn directly into a persistent 4K or 8K browser atlas without rebuilding plates and drainage; downloading that view is optional. A new categorical climate/topographic style keeps terrain classes flat while using a separate segmented mountain mask. Political borders, settlements, labels, authored regional editing, true polar graph topology, and full hydraulic erosion remain intentionally deferred until the base geography is consistently attractive.
