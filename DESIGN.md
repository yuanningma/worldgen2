# Atlas Forge — product and technical design

## Product direction

Atlas Forge is a map-making instrument, not a realism simulator with a map attached. Its first obligation is to produce continents that feel intentional: recognizable large-scale masses, varied silhouettes, peninsulas, inland texture, plausible mountain arcs, and river systems that visually belong to the terrain.

The interface follows the same principle. The world occupies nearly the entire workspace while a narrow instrument panel exposes only controls that materially change geography. The warm paper, field-survey typography, restrained vermilion accent, and dark ocean palette are meant to sit between a natural-history folio and a modern remote-sensing workstation.

## Why a hybrid generator

A complete plate-tectonic history is expensive, difficult to steer, and does not guarantee attractive land shapes. Pure fractal noise is fast but commonly produces amorphous blobs, noisy coastlines at every scale, and mountain ranges unrelated to the continents.

Atlas Forge therefore uses a hybrid of established procedural terrain patterns:

1. **Craton skeletons define composition.** A world begins as several curved chains of overlapping anisotropic cratons. Their spacing, branching, and aspect ratios establish readable continents before noise is added.
2. **Domain warping breaks geometry.** Low-frequency fractal noise bends the craton field. Additional octave bands introduce bays, peninsulas, and islands without erasing the large shape.
3. **Voronoi plates supply geological structure.** Moving plate sites define boundaries. Convergent relative motion raises narrow, modulated mountain belts; seeded interior arcs ensure important continents receive a strong range even when a random plate boundary falls offshore.
4. **Elevation drives climate and water.** Temperature follows latitude and lapse rate. Moisture combines broad weather fields with orographic drying. Biomes are derived data rather than independent painted patches.
5. **Priority-flood hydrology connects terrain to rivers.** A coarse drainage grid fills depressions from ocean outlets, assigns a downhill receiver, and accumulates rainfall. Only sufficiently large channels are rendered, keeping the map legible.
6. **A renderer interprets one world model.** Satellite and field-ink styles recolor and shade the same elevation, climate, and river data, so changing style does not invent a different planet.

This approach deliberately spends realism where a viewer can see it—continental composition, mountain continuity, drainage, shelves, and biome transitions—while avoiding a long physical simulation whose output would still need aesthetic filtering.

## Generation pipeline

```text
seed + controls
  → seeded craton chains and tectonic sites
  → warped continental scalar field
  → land/sea elevation and boundary uplift
  → temperature and moisture fields
  → depression filling and flow accumulation
  → biome classification and hillshade
  → satellite or ink pixels
```

The whole pipeline is deterministic. The UI sends a serializable settings object to a dedicated Web Worker, which transfers the finished pixel buffer back without copying it. The current 1008 × 630 working resolution is detailed enough for screen use and PNG export while remaining practical for rapid iteration.

## Aesthetic safeguards

- Macro shape is constructed before any high-frequency detail.
- Continent anchors are kept apart and faded before the map boundary.
- Noise amplitude is scale-aware: coastline controls alter medium and fine bands more than continental mass.
- Mountains are narrow ridges, not a second layer of blob noise.
- Rivers require accumulated upstream area, preventing uniform blue scratches.
- Ocean shelves track elevation immediately below sea level.
- Satellite colors are muted and hillshade is bounded so relief reads without looking embossed.

## Architecture

- `app/MapStudio.tsx` owns controls, worker orchestration, canvas display, and PNG export.
- `lib/world.ts` contains the deterministic terrain, plate, climate, hydrology, and rendering pipeline.
- `workers/world.worker.ts` isolates expensive generation from interaction and transfers the final raster.
- `app/globals.css` defines the responsive field-instrument interface.

No server data, account, or external API is required. A generated world never leaves the browser.

## Deliberate constraints in milestone one

- The map is an equirectangular framed world, not yet a seamless globe.
- Tectonics model boundary uplift rather than geological time, crust age, subduction, and mass conservation.
- Hydrology uses a reduced-resolution drainage graph and does not yet retain lakes.
- Ink mode is an alternate renderer, not yet a full label-and-symbol cartographic system.
- PNG export uses working resolution; tiled high-resolution export is the next performance milestone.

## Roadmap

### Milestone two — better landforms

- Spherical or horizontally wrapped topology
- Coast-aware thermal erosion and sediment fans
- Persistent lakes, deltas, and endorheic basins
- Continent quality scoring with automatic rejection of weak seeds
- Tiled 4K–8K generation with progressive preview

### Milestone three — authored worlds

- Brush-based land, ridge, moisture, and river constraints
- Regional regeneration that preserves the rest of a seed
- Saved world recipes and shareable URLs
- Named places, cultures, borders, and settlement suitability

### Milestone four — production renderer

- WebGPU compute path with Web Worker fallback
- Layer export for elevation, biome, rivers, masks, and normal maps
- More interpretations: parchment atlas, watercolor, shaded relief, and monochrome print
