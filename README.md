# Atlas Forge

Atlas Forge is a deterministic, browser-based fantasy world generator focused on beautiful continent silhouettes and convincing satellite-style terrain. Each seed produces tectonic regions, continental shelves, mountain systems, climate zones, and drainage networks entirely on the user's machine.

## Current milestone

- Cost-weighted crust growth on a high-resolution structural lattice
- Candidate scoring for land coverage, connectedness, and coastline complexity
- Coast-localized, multi-scale perturbation with bays and peninsula branches
- Voronoi-style tectonic plates with convergent-boundary uplift
- Curved mountain belts, thermal erosion, and flow-carved valleys
- Priority-Flood watershed routing, rainfall-weighted accumulation, and rivers
- Latitude, elevation, wind-order rainfall, and rain-shadow biome assignment
- Satellite and hand-ink rendering from the same world model
- Reproducible seeds, terrain controls, map zoom, and PNG export
- Generation runs in a Web Worker to keep the interface responsive

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validate

```bash
npm run build
npm run lint
```

The implementation and product decisions are documented in [DESIGN.md](./DESIGN.md).

## Project status

This is the first continent-and-satellite milestone. Political borders, settlements, labels, authored regional editing, and full hydraulic erosion are intentionally deferred until the base geography is consistently attractive.
