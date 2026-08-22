# Atlas Forge — product and technical design

## Product direction

Atlas Forge is a map-making instrument, not a realism simulator with a map attached. Its first obligation is to produce continents that feel intentional: recognizable large-scale masses, varied silhouettes, peninsulas, inland texture, plausible mountain arcs, and river systems that visually belong to the terrain.

The interface follows the same principle. The world occupies nearly the entire workspace while a narrow instrument panel exposes only controls that materially change geography. The warm paper, field-survey typography, restrained vermilion accent, and dark ocean palette are meant to sit between a natural-history folio and a modern remote-sensing workstation.

## Why a hybrid generator

A complete plate-tectonic history is expensive, difficult to steer, and does not guarantee attractive land shapes. Pure fractal noise is fast but commonly produces amorphous blobs, noisy coastlines at every scale, and mountain ranges unrelated to the continents.

Atlas Forge therefore uses a hybrid of established procedural terrain patterns:

1. **Cost-weighted crust growth defines composition.** Each candidate starts with spaced, curved crustal spines and separate peninsula branches. Multi-source Dijkstra growth expands across a warped resistance field. Varying source weights create broad shields, narrow isthmuses, and tapered capes instead of a constant-radius union of blobs.
2. **Shape selection rejects weak candidates.** Three inexpensive structural candidates are measured for land coverage, connected components, edge collisions, and scale-normalized coastline length. The strongest candidate is retained before expensive pixel work begins.
3. **A signed distance coast preserves scale hierarchy.** A chamfer distance transform converts the selected binary crust into a continuous land/sea field. Domain warping and several noise bands are attenuated with distance from the shoreline, so small coves do not turn continental interiors into undifferentiated noise. Subtractive coastal ellipses supply broad gulfs; branch growth supplies peninsulas.
4. **Tectonic structure and range distance fields supply relief.** Moving Voronoi-style plate sites raise convergent boundaries. Curved ranges attached to the crustal skeleton add reliable interior mountain systems. Ridged texture modulates those belts, while low hills remain a separate, lower-amplitude field.
5. **Weathering connects topography to drainage.** A bounded thermal erosion pass redistributes slopes above a talus threshold. Wind-order humidity produces orographic precipitation and rain shadows. Priority-Flood fills drainage depressions, assigns receivers, and accumulates spatial rainfall; rendered channels then carve shallow valleys into the final elevation field.
6. **A renderer interprets one world model.** Horn-style 3 × 3 surface normals, continuous biome blends, ocean depth, shelves, and river masks produce the satellite view. Field ink recolors the same elevation, climate, and water data, so style changes do not invent another planet.

This approach deliberately spends realism where a viewer can see it—continental composition, mountain continuity, drainage, shelves, and biome transitions—while avoiding a long physical simulation whose output would still need aesthetic filtering.

## Generation pipeline

```text
seed + controls
  → three weighted crust-growth candidates
  → shape scoring and signed coastal distance
  → plate boundaries and curved mountain belts
  → thermal erosion and wind-order climate
  → Priority-Flood drainage and valley carving
  → continuous biomes and normal-based hillshade
  → satellite or ink pixels
```

The whole pipeline is deterministic. The UI sends a serializable settings object to a dedicated Web Worker, which transfers the finished pixel buffer back without copying it. The current 1008 × 630 working resolution is detailed enough for screen use and PNG export while remaining practical for rapid iteration.

## Aesthetic safeguards

- Macro shape is constructed and scored before any high-frequency detail.
- Continent anchors are kept apart and structural growth is strongly penalized near the map boundary.
- Noise is strongest at the shoreline and decays inland and offshore.
- Mountains are narrow ridges, not a second layer of blob noise.
- Rivers require rainfall-weighted upstream area and guaranteed drainage, preventing uniform blue scratches.
- Ocean shelves track elevation immediately below sea level.
- Satellite colors blend continuously and hillshade is bounded so relief reads without looking embossed.

## Research basis

The implementation is original, but the pipeline deliberately follows lessons from established open-source generators and terrain literature:

- [Mapgen4](https://github.com/redblobgames/mapgen4) separates irregular mesh construction, mountain-distance elevation, wind-order rainfall, downslope flow, and GPU relief rendering. Its most important coastline lesson for Atlas Forge is to weight perturbation near the coast instead of applying equal noise everywhere.
- [WorldEngine](https://github.com/Mindwerks/worldengine) demonstrates that plate simulation is useful for mountain placement but still needs separate passes for noise, precipitation, erosion, humidity, and biomes. Atlas Forge keeps the structurally useful boundary uplift without treating a full geological history as the silhouette generator.
- [Terrain Erosion in 3 Ways](https://github.com/dandrino/terrain-erosion-3-ways) shows why fractional noise alone looks homogeneous, and compares hydraulic simulation with a faster river-network-first construction. Atlas Forge uses the same practical principle: the drainage graph must influence visible terrain.
- [FantasyMapGenerator](https://github.com/rlguy/FantasyMapGenerator) combines an irregular Delaunay/Voronoi grid, depression filling, flux-derived rivers, and erosion. Its documented Planchon–Darboux pipeline reinforced the choice to guarantee drainage before drawing channels.
- Barnes et al.'s [Priority-Flood paper](https://rbarnes.org/sci/2014_depressions.pdf) provides the depression-filling basis used by the watershed pass. The browser implementation uses a reduced-resolution raster heap rather than copying any project source.

These sources agree on a useful product decision: simulation passes should exchange structure—relief affects rain, rain affects flow, and flow affects valleys—but attractive continent composition needs explicit constraints and selection rather than an assumption that physical simulation will automatically produce a good map.

## Architecture

- `app/MapStudio.tsx` owns controls, worker orchestration, canvas display, and PNG export.
- `lib/world.ts` contains the deterministic terrain, plate, climate, hydrology, and rendering pipeline.
- `workers/world.worker.ts` isolates expensive generation from interaction and transfers the final raster.
- `app/globals.css` defines the responsive field-instrument interface.

No server data, account, or external API is required. A generated world never leaves the browser.

## Deliberate constraints in milestone one

- The map is an equirectangular framed world, not yet a seamless globe.
- Tectonics model boundary uplift rather than geological time, crust age, subduction, and mass conservation.
- Hydrology uses a reduced-resolution drainage graph and does not yet retain lakes or sediment fans.
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
