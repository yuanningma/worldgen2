# Atlas Forge — product and technical design

## Product direction

Atlas Forge is a map-making instrument, not a geology simulator with a map attached. Its first obligation is to produce continents that feel intentional: recognizable masses, a hierarchy of capes and gulfs, coherent mountain belts, and rivers that belong to the relief.

The engine therefore spends realism where it improves the picture. Plate motion organizes crust, ranges, and rifts. A separate dense coastline process supplies the smaller-scale complexity that tectonic cells cannot. Candidate selection and explicit coastal features remain aesthetic constraints because a plausible simulation does not automatically make a good map.

## Why a two-scale hybrid

Two earlier approaches exposed opposite weaknesses. Raster crust growth produced noisy inflated blobs. Directly rendering a Voronoi/Delaunay terrain graph improved topology, but coastlines still followed unions of large convex cells and linear triangle interpolation exposed facets.

Atlas Forge now keeps those representations separate:

1. **An irregular graph organizes the planet.** Deterministic Poisson-disc sites become a Delaunay adjacency graph. Well-separated weighted Voronoi seeds receive plate ownership, motion vectors, and continental or oceanic crust.
2. **A hierarchical world-composition plan replaces uniform plate spacing.** The user does not request a continent count. A seeded clustered point process first reserves one major ocean basin, then places two or three unequal continental provinces in the remaining longitudes. Plate adjacency grows a dominant system, secondary continents, and satellite systems inside those provinces. Their exact number still emerges when sea level cuts the height field. This avoids both farthest-point "land everywhere" spacing and one evenly sized island per plate.
3. **A terrane network replaces plate-shaped blobs.** Connected continental plate clusters seed broad cratonic cores, compressed plate links, asymmetric lobes, and only a few curved arms. One secondary system may become crescent-like; the rest stay compact. Variable-width negative paths cut selected gulfs, rifts, straits, and inland basins through that skeleton. All geometry is evaluated in the physical 2:1 map metric. Plate type contributes a smaller bias, while rotated gradient fields supply broad variation. Five candidates are scored for landmass hierarchy, an open-ocean sector, compactness, component count, and coast complexity before dense work begins.
4. **Longitude is periodic throughout the model.** Plate ownership, graph distance, seam adjacency, terrane strokes, climate fields, signed coastal distance, relief sampling, and river drawing all wrap horizontally. A continent can cross the equirectangular seam without becoming two unrelated islands.
5. **Relative plate motion organizes relief and island arcs.** Convergent and divergent graph edges become multi-source distance fields. They control mountain envelopes and rifts without deciding every shoreline point. Strong convergence on oceanic crust also raises a noise-gated chain of potential islands before sea level is selected, so the surviving arc is a tectonic consequence rather than decorative scatter.
6. **Graph Priority-Flood guarantees drainage.** Depression conditioning assigns receivers, moisture-weighted contributing area selects river paths, and river vertices carve the structural elevation.
7. **A dense signed-distance coast breaks free of the mesh.** The selected crust potential is rasterized into a macro mask and converted to a horizontally wrapped exact Euclidean signed-distance field. The separable linear-time transform avoids the grid bias of the earlier chamfer approximation, while domain warping displaces the field in pixel space.
8. **Coastal detail has a scale hierarchy.** Broad, regional, fine, and micro periodic-gradient fields are confined to a coastal envelope. A small independently implemented Donjon-inspired spherical fault atlas adds long correlated cuts. Roughly two dozen semantic coastal systems are then placed from actual land/ocean graph boundaries: branching, variable-width negative paths create nested gulfs and drowned valleys, while a smaller number of broad positive paths create capes and peninsulas. Spatial bounds keep this richer grammar fast.
9. **Sea level is a first-class heightmap cut.** Continental mass controls the amount and reach of structural crust, while a separate global sea-level control selects a dense histogram quantile after coastal displacement. This makes flooding and exposing shelves predictable without asking the tectonic grammar to regenerate a different planet. Oceanic polar caps keep the projection readable without imposing an artificial longitude frame.
10. **Visible relief is synthesized at output resolution.** A denser graph and additional broad smoothing supply the macro surface. Continuous hills and folded ridged detail are modulated by convergent-boundary strength, so mountain chains remain geological without exposing Delaunay triangles.
11. **Rendering is coverage-aware.** A local signed-field gradient estimates subpixel land coverage. Sea, beach, and land colors blend through that coverage; mountain color thresholds come from land-height quantiles, and broad-dominant hillshade keeps ranges legible without making them chunky.
12. **Rivers are curves, not pixel stamps.** Complete receiver chains are unwrapped across the seam, smoothed twice, then rasterized as variable-width antialiased capsules and clipped to the refined coast.
13. **The same texture supports two projections.** Atlas mode shows the complete 2:1 equirectangular world without cropping. Globe mode bilinearly projects it onto a shaded orthographic sphere that supports pointer, touch, and keyboard rotation.
14. **Large output is a render problem, not a larger simulation.** The Worker retains the selected height/coast/river model and rasterizes either a 4096 × 2048 or 8192 × 4096 cartographic atlas in 128-row strips. Export-only periodic coast octaves add detail at roughly 40, 17, and 7-pixel wavelengths. Only the final browser canvas is full size; the intermediate terrain fields stay at the selected working resolution.

## Generation pipeline

```text
seed + controls
  → Poisson-disc sites and Delaunay adjacency
  → weighted Voronoi plates and motion
  → periodic seam adjacency and wrapped plate distance
  → hierarchical continental provinces around a reserved ocean basin
  → compact cratonic cores, asymmetric lobes, and sparse arms
  → subtractive gulfs, rifts, straits, and inland basins
  → candidate scoring and sea-level cut
  → convergent/rift fields and graph Priority-Flood
  → macro mask and signed coastal distance
  → domain warp + multiscale coast detail + fault residual
  → explicit capes, bays, straits, and near-coast islands
  → dense folded relief and quantile-based mountain classes
  → antialiased coasts, curved rivers, and multiscale hillshade
  → seamless satellite or field-ink texture
  → equirectangular atlas or interactive orthographic globe
  → optional 4K or 8K strip-rendered cartographic atlas
```

The pipeline is deterministic. The UI sends a serializable recipe to a dedicated Web Worker, which transfers a display copy while retaining the reusable height model for export. Simulation density is fixed at roughly 22,000 graph sites and is independent of render resolution, so the same seed keeps the same plate world at Preview (1024 × 512), High (1536 × 768), and Ultra (2048 × 1024). High is the default. Broad sliding-window relief filters remove visible Delaunay facets without erasing continuous high-resolution surface detail. Generation remains off the interaction thread; globe rotation reprojects the completed texture without regenerating geography. The 4K and 8K export paths transfer bounded 128-row strips; their final RGBA canvases occupy about 32 MiB and 128 MiB respectively before PNG encoding.

## Aesthetic safeguards

- Macro composition is selected before hydrology and dense pixel work.
- Continental systems occupy unequal clustered provinces, with a deliberately readable ocean basin between them.
- Candidate scoring rewards one dominant system, secondary landmasses, compact silhouettes, and a non-trivial open-ocean longitude sector.
- Tectonic cells guide continents but never become visible polygons.
- Coastal displacement is measured in pixels and fades to zero inland and offshore.
- Explicit features add medium-scale geography so complexity is not merely uniform edge noise.
- Broad cratonic lobes create silhouette hierarchy; long constructive branches are sparse rather than a repeated default.
- Continental tips remain rounded and tapered; complexity comes from composition rather than uniformly jagged shores.
- Donjon-like random faults are a minority residual; the tectonic/terrane field remains the constraint.
- Continental systems emerge from the seeded plate/craton process; candidate scoring only rejects pathological too-few or too-many outcomes.
- Sea level remains independent of that structure, so flooding shelves does not regenerate a different tectonic world.
- A dense land-area quantile and oceanic polar caps keep composition stable while longitude remains seamless.
- Mountain folds inherit convergent-boundary envelopes and use seed-independent height quantiles for reliable visual emphasis.
- White pixel grain and square river brushes are deliberately avoided.
- The fixed twelve-seed visual suite checks repeated silhouettes, speck islands, clipped land, overexposed ranges, and weak coast hierarchy.

## Research basis

The implementation is original, but its structure follows lessons from established generators and terrain literature:

- The official [Donjon Fractal World Generator description](https://donjon.bin.sh/code/world/) explains its repeated random great-circle faulting followed by histogram sea-level selection. Atlas Forge independently implements a small fault-field residual, confines it to the coast, and lets tectonics retain control of the planet-scale structure.
- [Mapgen4](https://github.com/redblobgames/mapgen4) demonstrates an irregular-mesh pipeline in which mountain distance, downslope flow, rainfall, and rendering exchange structure. Atlas Forge follows the graph-first simulation lesson while adding a separate dense rendering surface.
- [Mapgen2](https://github.com/redblobgames/mapgen2) separates polygonal regions from corner elevation and river flow, and shows why constructive composition and redistributed elevation are useful aesthetic controls.
- Red Blob Games' [terrain-from-noise retrospective](https://www.redblobgames.com/maps/terrain-from-noise/) explicitly calls out the weakness of local noise: every region tends to feel the same and the generator has no global constraints. The clustered-province plan is the global compositional layer that the shoreline noise cannot provide.
- Red Blob Games' [Noisy Edges](https://www.redblobgames.com/maps/noisy-edges/) shows how constrained recursive subdivision adds bounded edge hierarchy rather than unconstrained white noise. Atlas Forge currently applies the same scale-separation lesson in its continuous coast field and keeps direct contour subdivision as a future refinement.
- Felzenszwalb and Huttenlocher's [Distance Transforms of Sampled Functions](https://www.cs.cornell.edu/dph/papers/dt.pdf) supplies the separable exact Euclidean distance-transform method used by the dense wrapped coastline pass.
- [D3 Delaunay](https://d3js.org/d3-delaunay) supplies the robust triangulation used for graph adjacency and the dual Voronoi interpretation.
- [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) demonstrates the value of composing heightmaps from purposeful hills, ranges, pits, troughs, and straits rather than relying on one universal noise field.
- [WorldEngine](https://github.com/Mindwerks/worldengine) and [plate-tectonics](https://github.com/Mindwerks/plate-tectonics) keep tectonic simulation, heightmap output, and sea-level parameters distinct; Atlas Forge follows that separation while retaining its more composition-driven coast grammar.
- [World Machine's tiled-build documentation](https://help.world-machine.com/topic/world-machine-professional-edition-addendum/) notes that single huge heightfields become unwieldy around 8192 × 8192 and uses tiled output to go larger. Atlas Forge applies the same memory lesson inside the browser with strip rendering.
- Barnes et al.'s [Priority-Flood paper](https://rbarnes.org/sci/2014_depressions.pdf) provides the depression-conditioning basis used by the watershed pass.

These sources reinforce a practical division of labor: plates and flow provide believable relationships, fractal fields provide scale-rich detail, and explicit composition rules decide whether the result is attractive.

## Architecture

- `app/MapStudio.tsx` owns controls, Worker orchestration, atlas display, orthographic globe projection, rotation, zoom, and PNG export.
- `lib/world.ts` owns mesh construction, plate fields, candidate selection, graph hydrology, dense coastline synthesis, relief, and rendering.
- `workers/world.worker.ts` isolates generation, retains the current world model, and streams high-resolution export strips.
- `types/d3-delaunay.d.ts` types the small triangulation surface used by the engine.
- `app/globals.css` defines the responsive field-instrument interface.

No server data, account, or external API is required. There is intentionally no authentication during this iteration, and generated worlds never leave the browser.

## Deliberate constraints

- Longitude is genuinely periodic, but the simulation graph remains cylindrical with oceanic caps rather than using a fully spherical polar topology.
- Plates are conceptual ownership and stress regions, not a time-stepped model of crust age, subduction, or mass conservation.
- Coast features are seeded constructive fields rather than a simulation of sediment transport or glaciation.
- Climate color currently uses latitude, height, coherent moisture, and the moisture control; directional precipitation remains deferred.
- Hydrology retains river paths but not persistent lakes, deltas, sediment fans, or endorheic basins.
- Field-ink mode is an alternate renderer, not yet a complete label-and-symbol cartographic system.
- The downloadable 4K/8K PNGs are flattened cartographic images; separate 16-bit elevation, biome, normal, and river layers remain future work.

## Roadmap

### Next landform milestone

- Raster-preview candidate scoring with multiscale perimeter, bay, cape, and island metrics
- True spherical graph topology with polar stitching and latitude-aware cell area
- Tectonic island arcs and landward-offset subduction ranges
- Coast-aware erosion, sediment fans, persistent lakes, and deltas
- Directional climate with orographic precipitation and rain shadows

### Authored worlds

- Brush-based land, ridge, moisture, and river constraints
- Regional regeneration that preserves the rest of a seed
- Saved world recipes and shareable URLs
- Named places, cultures, borders, and settlement suitability

### Production renderer

- Progressive regional rerendering and multi-file tiled export beyond 8K
- WebGPU compute path with Web Worker fallback
- Layer export for elevation, biome, rivers, masks, and normal maps
- More interpretations: parchment atlas, watercolor, shaded relief, and monochrome print
