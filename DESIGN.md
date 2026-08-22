# Atlas Forge — product and technical design

## Product direction

Atlas Forge is a map-making instrument, not a geology simulator with a map attached. Its first obligation is to produce continents that feel intentional: recognizable large-scale masses, varied silhouettes, peninsulas and gulfs, coherent mountain belts, and rivers that belong to the relief.

The interface follows the same principle. The world occupies nearly the entire workspace while a narrow instrument panel exposes only controls that materially change geography. The warm paper, field-survey typography, restrained vermilion accent, and dark ocean palette sit between a natural-history folio and a modern remote-sensing workstation.

## Why an irregular graph

The first Atlas Forge prototype grew crust on a regular raster. Although fast, that representation encouraged inflated noise masks: coastlines acquired detail without acquiring structure, rivers revealed grid directions, and mountains did not share a useful topology with drainage.

The current engine instead uses one irregular graph for composition, terrain, tectonics, and hydrology:

1. **Poisson-disc sites establish an even but non-grid sampling.** A deterministic Bridson-style sampler supplies interior sites, while a narrow boundary ring closes the rectangular domain.
2. **Delaunay edges become the simulation graph.** The triangulation supplies compact adjacency for terrain propagation, connected-component tests, erosion, and drainage. The dual Voronoi interpretation is used for plate ownership; visible terrain is not rendered as flat Voronoi polygons.
3. **Conceptual plates create continent-scale organization.** Well-separated plate seeds receive weighted Voronoi regions and motion vectors. Connected plate clusters are marked as continental crust, then combined with low-frequency fields into a continuous crust potential.
4. **Sea level cuts a continuous field.** The requested continent mass determines a quantile rather than a magic elevation constant. Five deterministic candidates are scored for major landmasses, dominance, tiny-island debris, coast complexity, and map-frame clearance before expensive rendering proceeds.
5. **Plate-boundary distance fields organize relief.** Relative motion classifies convergent and divergent graph edges. Multi-source Dijkstra propagation turns those sparse boundaries into narrow mountain and rift influence fields; graph thermal erosion softens only excessive slopes.
6. **Graph hydrology guarantees an outlet.** A Priority-Flood pass raises graph depressions just enough to assign drainage receivers. Moisture-weighted contributing area selects channels, and those same graph paths are carved into the elevation before raster rendering.
7. **Delaunay triangles produce a continuous image.** Barycentric interpolation converts graph elevation to pixels. Raster hillshade, ocean depth, shelves, climate tint, and river masks interpret that shared world model as either satellite relief or field ink.

This is intentionally a hybrid. Plate concepts provide useful large-scale structure, but a long geological history is not used as the silhouette generator. Aesthetic candidate selection remains explicit because physical plausibility alone does not guarantee an attractive map.

## Generation pipeline

```text
seed + controls
  → Poisson-disc sites and Delaunay adjacency
  → weighted Voronoi plate ownership
  → connected continental plate clusters
  → continuous crust potential and sea-level quantile
  → five-candidate structural scoring
  → convergent/rift distance fields and graph erosion
  → Priority-Flood drainage and valley carving
  → barycentric triangle rasterization
  → satellite or field-ink pixels
```

The pipeline is deterministic. The UI sends a serializable settings object to a dedicated Web Worker, which transfers the completed pixel buffer back without copying it. At the default 1008 × 630 working resolution, the graph is capped near 15,500 sites and generation remains comfortably sub-second on the development machine.

## Aesthetic safeguards

- Macro composition is generated and scored before hydrology or pixel work.
- Plate seeds are spatially separated, while continental ownership grows through connected plate neighbors.
- A hard ocean margin and a softer edge penalty prevent cropped continents at the framed map boundary.
- Coast detail perturbs a continuous crust potential; it does not displace every coast point independently.
- Mountains propagate away from convergent plate edges as narrow fields instead of appearing as isolated noise peaks.
- Rivers require moisture-weighted upstream area and use guaranteed graph drainage.
- Ocean shelves use elevation immediately below sea level.
- Satellite colors blend continuously, and bounded hillshade keeps relief legible without an embossed look.

## Research basis

The implementation is original, but its structure follows lessons from established open-source generators and terrain literature:

- [Mapgen4](https://github.com/redblobgames/mapgen4) demonstrates a clean irregular-mesh pipeline in which elevation, wind order, downslope flow, and rendering exchange structure. Atlas Forge adopts the central graph-first lesson while using automatic continent composition rather than a paint workflow.
- [Mapgen2](https://github.com/redblobgames/mapgen2) shows the practical value of separating polygonal regions from corner-based elevation and river flow. Atlas Forge likewise simulates on graph vertices and renders a continuous field instead of exposing cell polygons.
- [D3 Delaunay](https://d3js.org/d3-delaunay) supplies the robust Delaunay triangulation used to construct adjacency and the dual Voronoi interpretation.
- [WorldEngine](https://github.com/Mindwerks/worldengine) demonstrates that plate simulation is useful for mountain placement but still needs distinct elevation, precipitation, erosion, and biome passes. Atlas Forge keeps structurally useful boundary uplift without treating a full geological history as the coast generator.
- [FantasyMapGenerator](https://github.com/rlguy/FantasyMapGenerator) combines an irregular Delaunay/Voronoi grid, depression filling, flux-derived rivers, and erosion. Its pipeline reinforced the decision to guarantee drainage before drawing channels.
- Barnes et al.'s [Priority-Flood paper](https://rbarnes.org/sci/2014_depressions.pdf) provides the depression-filling basis used by the watershed pass.

The common design lesson is that simulation passes should exchange structure—relief affects drainage and drainage affects visible valleys—but attractive continental composition still benefits from explicit constraints and candidate rejection.

## Architecture

- `app/MapStudio.tsx` owns controls, Worker orchestration, canvas display, zoom, and PNG export.
- `lib/world.ts` owns deterministic mesh construction, plate fields, terrain selection, graph hydrology, interpolation, and rendering.
- `workers/world.worker.ts` isolates generation from interaction and transfers the final raster.
- `types/d3-delaunay.d.ts` keeps the small triangulation surface typed without pulling extra runtime code.
- `app/globals.css` defines the responsive field-instrument interface.

No server data, account, or external API is required. There is intentionally no authentication during this iteration, and generated worlds never leave the browser.

## Deliberate constraints in this milestone

- The map is an equirectangular framed world, not yet a horizontally wrapped globe.
- Plates are conceptual Voronoi ownership regions, not a time-stepped model of crust age, subduction, or mass conservation.
- Climate tint currently uses latitude, height, coherent moisture noise, and the moisture control; full wind-order precipitation is deferred.
- Hydrology retains river paths but not lakes, sediment fans, deltas, or endorheic basins.
- Field-ink mode is an alternate renderer, not yet a complete label-and-symbol cartographic system.
- PNG export uses working resolution; tiled high-resolution export is a later performance milestone.

## Roadmap

### Milestone two — better landforms

- Horizontally wrapped or spherical graph topology
- Coast-aware erosion, sediment fans, persistent lakes, and deltas
- Directional climate with orographic precipitation and rain shadows
- More composition archetypes and stricter automatic seed rejection
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
