# Atlas Forge

Atlas Forge is a deterministic, browser-based fantasy world generator focused on strong continent silhouettes and convincing satellite-style relief. It runs entirely on the user's machine and currently requires no account or server API.

## Current milestone

- Deterministic Poisson-disc sampling and Delaunay graph construction
- Weighted Voronoi plate ownership with connected continental plate clusters
- Continuous crust potential with sea-level quantile control
- Five-candidate scoring for landmass balance, coastline structure, islands, and frame clearance
- Convergent-boundary mountain fields, rifts, graph thermal erosion, and flow-carved valleys
- Graph Priority-Flood drainage, moisture-weighted accumulation, and rivers
- Barycentric triangle interpolation for smooth, cell-free relief
- Satellite and field-ink rendering from the same terrain model
- Reproducible seeds, terrain controls, zoom, and PNG export
- Web Worker generation to keep the interface responsive

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

This is the first Voronoi continent-and-satellite checkpoint. Political borders, settlements, labels, authored regional editing, spherical wrapping, and full hydraulic erosion are intentionally deferred until the base geography is consistently attractive.
