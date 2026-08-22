# Atlas Forge — product and technical design

## Product direction

Atlas Forge is a map-making instrument, not a geology simulator with a map attached. Its first obligation is to produce continents that feel intentional: recognizable masses, a hierarchy of capes and gulfs, coherent mountain belts, and rivers that belong to the relief.

The engine therefore spends realism where it improves the picture. Plate motion organizes crust, ranges, and rifts. A separate dense coastline process supplies the smaller-scale complexity that tectonic cells cannot. Candidate selection and explicit coastal features remain aesthetic constraints because a plausible simulation does not automatically make a good map.

## Why a two-scale hybrid

Two earlier approaches exposed opposite weaknesses. Raster crust growth produced noisy inflated blobs. Directly rendering a Voronoi/Delaunay terrain graph improved topology, but coastlines still followed unions of large convex cells and linear triangle interpolation exposed facets.

Atlas Forge now keeps those representations separate:

1. **An irregular graph organizes the planet.** Deterministic Poisson-disc sites become a Delaunay adjacency graph. Well-separated weighted Voronoi seeds receive plate ownership, motion vectors, and continental or oceanic crust.
2. **Continuous cratons replace categorical plate-shaped continents.** Connected continental plate clusters seed overlapping anisotropic crust lobes. Plate type contributes a smaller bias, while rotated gradient fields supply broad variation. Five candidates are scored before dense work begins.
3. **Relative plate motion organizes relief.** Convergent and divergent graph edges become multi-source distance fields. They control mountain envelopes and rifts without deciding every shoreline point.
4. **Graph Priority-Flood guarantees drainage.** Depression conditioning assigns receivers, moisture-weighted contributing area selects river paths, and river vertices carve the structural elevation.
5. **A dense signed-distance coast breaks free of the mesh.** The selected crust potential is rasterized into a macro mask and converted to a chamfer signed-distance field. Domain warping displaces that field in pixel space.
6. **Coastal detail has a scale hierarchy.** Broad, regional, and fine rotated-gradient fields are confined to a coastal envelope. A small independently implemented Donjon-inspired spherical fault atlas adds long correlated cuts. Deterministic elongated positive and negative coastal features deliberately create peninsulas, bays, and straits.
7. **Sea level remains controllable.** A dense histogram quantile restores the requested land fraction after coastal displacement, and a hard ocean margin prevents cropped continents.
8. **Visible relief is synthesized at output resolution.** Smoothed graph elevation supplies the macro surface. Continuous hills and folded ridged detail are modulated by convergent-boundary strength, so mountain chains remain geological but no longer reveal Delaunay triangles.
9. **Rendering is coverage-aware.** A local signed-field gradient estimates subpixel land coverage. Sea, beach, and land colors blend through that coverage; mountain color thresholds come from land-height quantiles, and broad plus fine hillshade makes ranges legible.
10. **Rivers are curves, not pixel stamps.** Complete receiver chains are smoothed twice, then rasterized as variable-width antialiased capsules and clipped to the refined coast.

## Generation pipeline

```text
seed + controls
  → Poisson-disc sites and Delaunay adjacency
  → weighted Voronoi plates and motion
  → connected anisotropic cratons
  → candidate scoring and sea-level cut
  → convergent/rift fields and graph Priority-Flood
  → macro mask and signed coastal distance
  → domain warp + multiscale coast detail + fault residual
  → explicit capes, bays, straits, and near-coast islands
  → dense folded relief and quantile-based mountain classes
  → antialiased coasts, curved rivers, and multiscale hillshade
  → satellite or field-ink pixels
```

The pipeline is deterministic. The UI sends a serializable recipe to a dedicated Web Worker, which transfers the finished pixel buffer without copying it. The default 1008 × 630 map uses up to roughly 15,500 graph sites; the more expensive coastal and surface work occurs only for the chosen candidate. A default generation takes roughly three seconds on the development machine while interaction remains responsive.

## Aesthetic safeguards

- Macro composition is selected before hydrology and dense pixel work.
- Tectonic cells guide continents but never become visible polygons.
- Coastal displacement is measured in pixels and fades to zero inland and offshore.
- Explicit features add medium-scale geography so complexity is not merely uniform edge noise.
- Donjon-like random faults are a minority residual; the tectonic/craton field remains the constraint.
- A hard ocean frame and a dense land-area quantile keep composition stable.
- Mountain folds inherit convergent-boundary envelopes and use seed-independent height quantiles for reliable visual emphasis.
- White pixel grain and square river brushes are deliberately avoided.
- The fixed twelve-seed visual suite checks repeated silhouettes, speck islands, clipped land, overexposed ranges, and weak coast hierarchy.

## Research basis

The implementation is original, but its structure follows lessons from established generators and terrain literature:

- The official [Donjon Fractal World Generator description](https://donjon.bin.sh/code/world/) explains its repeated random great-circle faulting followed by histogram sea-level selection. Atlas Forge independently implements a small fault-field residual, confines it to the coast, and lets tectonics retain control of the planet-scale structure.
- [Mapgen4](https://github.com/redblobgames/mapgen4) demonstrates an irregular-mesh pipeline in which mountain distance, downslope flow, rainfall, and rendering exchange structure. Atlas Forge follows the graph-first simulation lesson while adding a separate dense rendering surface.
- [Mapgen2](https://github.com/redblobgames/mapgen2) separates polygonal regions from corner elevation and river flow, and shows why constructive composition and redistributed elevation are useful aesthetic controls.
- [D3 Delaunay](https://d3js.org/d3-delaunay) supplies the robust triangulation used for graph adjacency and the dual Voronoi interpretation.
- [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) demonstrates the value of composing heightmaps from purposeful hills, ranges, pits, troughs, and straits rather than relying on one universal noise field.
- Barnes et al.'s [Priority-Flood paper](https://rbarnes.org/sci/2014_depressions.pdf) provides the depression-conditioning basis used by the watershed pass.

These sources reinforce a practical division of labor: plates and flow provide believable relationships, fractal fields provide scale-rich detail, and explicit composition rules decide whether the result is attractive.

## Architecture

- `app/MapStudio.tsx` owns controls, Worker orchestration, canvas display, zoom, and PNG export.
- `lib/world.ts` owns mesh construction, plate fields, candidate selection, graph hydrology, dense coastline synthesis, relief, and rendering.
- `workers/world.worker.ts` isolates generation from interaction and transfers the final raster.
- `types/d3-delaunay.d.ts` types the small triangulation surface used by the engine.
- `app/globals.css` defines the responsive field-instrument interface.

No server data, account, or external API is required. There is intentionally no authentication during this iteration, and generated worlds never leave the browser.

## Deliberate constraints

- The map is an equirectangular framed world, not yet a horizontally wrapped globe.
- Plates are conceptual ownership and stress regions, not a time-stepped model of crust age, subduction, or mass conservation.
- Coast features are seeded constructive fields rather than a simulation of sediment transport or glaciation.
- Climate color currently uses latitude, height, coherent moisture, and the moisture control; directional precipitation remains deferred.
- Hydrology retains river paths but not persistent lakes, deltas, sediment fans, or endorheic basins.
- Field-ink mode is an alternate renderer, not yet a complete label-and-symbol cartographic system.
- PNG export uses working resolution; tiled 4K–8K export is a later performance milestone.

## Roadmap

### Next landform milestone

- Raster-preview candidate scoring with multiscale perimeter, bay, cape, and island metrics
- Horizontally wrapped or spherical graph topology
- Tectonic island arcs and landward-offset subduction ranges
- Coast-aware erosion, sediment fans, persistent lakes, and deltas
- Directional climate with orographic precipitation and rain shadows

### Authored worlds

- Brush-based land, ridge, moisture, and river constraints
- Regional regeneration that preserves the rest of a seed
- Saved world recipes and shareable URLs
- Named places, cultures, borders, and settlement suitability

### Production renderer

- Progressive and tiled high-resolution generation
- WebGPU compute path with Web Worker fallback
- Layer export for elevation, biome, rivers, masks, and normal maps
- More interpretations: parchment atlas, watercolor, shaded relief, and monochrome print
