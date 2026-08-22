# Atlas Forge

Atlas Forge is a deterministic browser-based fantasy world generator focused on strong continent silhouettes and readable satellite-style relief. It runs entirely on the user's machine and requires no account or server API.

## Current milestone

- Poisson-disc sampling, Delaunay graph simulation, and weighted Voronoi plates
- Connected anisotropic cratons that keep continents from tracing plate polygons
- Five-candidate composition scoring and controllable sea-level quantiles
- Dense signed-distance coastlines with domain warp and multiscale fractal detail
- A bounded Donjon-inspired spherical fault residual near the coast
- Explicit seeded peninsulas, bays, straits, and near-coast islands
- Convergent mountain envelopes with high-resolution folded relief
- Graph Priority-Flood drainage and moisture-weighted river accumulation
- Smoothed, antialiased, continuously scaled river rendering
- Coverage-aware shores, dynamic mountain color classes, and multiscale hillshade
- Satellite and field-ink interpretations from the same world model
- Reproducible controls, zoom, PNG export, and responsive Web Worker generation

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

This is the second continent-and-satellite checkpoint. Political borders, settlements, labels, authored regional editing, spherical wrapping, and full hydraulic erosion remain intentionally deferred until the base geography is consistently attractive.
