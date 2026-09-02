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

## Tectonic simulator prototype

The replacement geology core is being developed separately from the current visual generator under `lib/tectonics/`, `lib/spherical/`, and `lib/evaluation/`. It now generates deterministic whole-sphere prototype worlds with:

- a closed subdivided icosphere with exact spherical areas;
- plate domains, Euler-pole boundary kinematics, and persistent boundary history;
- persistent continental and oceanic crust state with age, thickness, density, provenance, uplift, rifting, and arc accretion;
- persistent Lagrangian parcel IDs, exact Euler advection, and conservative local capacitated-flow remapping with explicit gap/overlap and transport-distance diagnostics;
- an opt-in coupled finite-volume history where plate mixtures, fractional continental material, provenance, relief, and deformation memory cross only adjacent geodesic edges and feed back into the next tectonic step;
- five to seven irregularly spaced primordial crustal communities, each assembled from unequal competing terrane lobes; fronts from one community may suture while fronts from different communities retain oceanic separators, so the initializer neither packs identical continents nor welds every source into one union hull;
- surface-area-scaled primordial capacity for larger planets, including multiple separated accreted terranes on sufficiently large plates, while Earth-scale seeded worlds and the absence of a final continent-count control remain unchanged;
- radius-normalized Euler rates that preserve plate velocity in kilometres per million years, plus refinement-aware terrane walks that preserve continent-building wavelengths on the subdivision-5 production mesh;
- inherited divergent weak belts and accretionary sutures carried conservatively through coupled transport, where they condition crust thickness, relief, shoreline character, and the connected-rift breakup gate;
- persistence-, speed-, continuity-, and ocean-connection-gated rifting that distinguishes shallow failed rifts from mature breakup corridors while retaining old-craton resistance;
- production-tier canonical shoreline shaping confined to the first four coastal control rings, with fixed-physical-scale rift embayments, terrane capes, and collision-supported promontories solved before the global ocean quantile; coarse subdivision-3 worlds remain unchanged because those features are not resolved there;
- isostatic elevation, age-dependent ocean depth, and one area-weighted canonical sea level shared by every projection;
- plate-aware irregular continental graph growth without a user-facing continent-count control;
- persistent subordinate accreted terranes with unequal area hierarchy, provenance, shelf tapering, and finite-width interior sutures;
- terrane-, suture-, age-, and margin-conditioned surface lithology with rock-dependent relief retention, fluvial incision, and closed sediment budgets by material class;
- boundary-specific orogenic profiles that distinguish continental collision cores, landward subduction ranges, oceanic island arcs, inherited sutures, and their lower-amplitude foothills;
- kilometre-scaled continental flexure that places sedimentary foreland basins and low outer bulges beyond convergent mountain cores without changing canonical coastlines;
- one physical-distance continental-margin field shared by coast refinement and terrain: active margins stay rugged while tectonically quiet present-day margins can develop broad, low sedimentary coastal plains without moving the land mask;
- reduced spherical atmospheric circulation with latitude-dependent wind belts, physical-distance-scaled ocean moisture recharge and downwind transport, orographic precipitation, and rain shadows;
- PET-relative aridity, marine and terrestrial biome classes, same-medium coast distance, continentality, seasonal-temperature range, and bounded spill-basin lake cover with closed global area accounting;
- spherical hard gates for ribbons, isthmuses, gulfs, lakes, elongation, canonical border stability, and multiscale coastline richness;
- deterministic multi-seed evaluation and accepted-only ranking;
- exact scientific and smoothed presentation atlas renderers;
- a persistent nested geodesic surface-process grid with topology-safe coast refinement, geology-conditioned relief, spherical moisture circulation, conservative runoff, hierarchical Priority-Flood drainage, resolved river networks, bounded stream-power incision, and conservative downstream sediment transfer;
- isotropic domain-warped drainage relief at roughly 150–1,500 km wavelengths, replacing the preferred directions of the former three-wave terrain signal; hydrology and erosion retain the full field while fine climate meshes use a fixed ~220 km subgrid-orography footprint;
- land-to-land drainage inheritance across nested grids, with a refined-strait fallback only when no fine land crossing exists, so coastline detail cannot silently capture or discard an entire canonical watershed;
- a resolution-independent presentation sampler that continuously blends same-surface elevation, climate, bathymetry, and terrain gradients while preserving the canonical spherical coast at every raster size;
- shared-junction river relaxation plus basin-coherent 110–650 km bend wavelengths integrated along each receiver chain, with stronger kilometre-preserving lowland bends that no longer force one synthetic oscillation into every triangular process edge while receiver topology and water/sediment budgets remain unchanged;
- basin-aware continuous lake contours that remove most process-cell facets without changing canonical lake area or water budgets;
- annual-equilibrium lake area, open-water evaporation, closed/overflowing lake classification, water-budget closure, and resolution-stable inherited lake levels;
- deterministic monthly runoff, lake temperature, ice, storage, evaporation, and overflow cycles with perennial/ephemeral and tectonic-persistence diagnostics while the annual atmosphere remains the conserved climate backbone;
- hybrid fill-or-breach depression evolution that lets high-discharge rivers incise bounded, lithology-aware spillways while preserving dry, cold, volcanic, and structurally resistant basins;
- conservative land-only hillslope diffusion that redistributes exactly equal terrain volume from unstable high cells to lower neighbors, then reroutes drainage without changing canonical coast authority;
- drainage-conditioned continuous valley relief that resolves narrow fluvial cuts below the process-cell scale while leaving process elevation, basins, lakes, and river topology unchanged;
- relief-conditioned world-space channel paths with shared junction tangents and basin-coherent phase that add bounded lowland bends while keeping steep mountain channels confined and all junctions tied to the resolved drainage graph;
- planet-size-aware continental-interior relief centers selected from stable, quiet cratonic interiors; these add broad drainage divides at fixed physical wavelengths without changing the canonical coast or specifying a continent count;
- explicit ocean-mouth and lake-inflow records classified as deltas, estuaries, alluvial fans, simple mouths, or lake inflows; ocean mouths retain their actual terminal sediment flux and use it to bound topology-safe distributaries, delta-plain scale, and presentation-only progradation;
- synchronized natural, heightmap, climate, biomes, precipitation, aridity, temperature, continentality, drainage, depression, geomorphology, coasts, wind, lithology, and orogeny diagnostics that all read the same canonical world instead of regenerating geography;
- five bounded coastline wavelength bands plus relief-conditioned rocky-margin notches, passive-margin undulation, and deterministic world-space fine relief that reveal smaller features at larger output sizes without moving canonical anchors.
- two renderer-only natural presentation styles: a flat illustrated atlas for judging world composition and a restrained physical relief view for inspecting terrain and bathymetry without changing geography.

Generate and evaluate worlds without starting or deploying the web app:

```bash
npm run debug:tectonics -- --seed=RIFT-02 --subdivisions=3 --plates=8
npm run evaluate:tectonics -- --seeds=ATLAS-A,ATLAS-B,ATLAS-C --subdivisions=4
npm run evaluate:tectonics -- --seeds=ATLAS-A,ATLAS-B,ATLAS-C --subdivisions=5 --moving-myr=2
npm run evaluate:tectonics -- --model=coupled --history-myr=120 --seeds=ATLAS-A,ATLAS-B --subdivisions=5
npm run evaluate:surface-resolution -- --seed=primeval-atlas-7 --reference-subdivisions=6 --candidate-subdivisions=7
npm run evaluate:surface-resolution -- --model=coupled --seed=primeval-atlas-7 --reference-subdivisions=6 --candidate-subdivisions=7
npm run render:tectonic-surface -- --model=coupled --history-myr=120 --seed=ATLAS-A --subdivisions=5
npm run render:tectonic-atlas -- --seed=ATLAS-A --subdivisions=5 --output=outputs/tectonics/world.png
npm run render:tectonic-candidates -- --seeds=ATLAS-A,ATLAS-B,ATLAS-C,ATLAS-D
npm run render:tectonic-surface -- --seed=ATLAS-A --subdivisions=5
npm run render:surface-process -- --model=coupled --seed=ATLAS-A --subdivisions=5 --surface-subdivisions=6
npm run render:surface-process -- --quality=high --model=coupled --seed=ATLAS-A
npm run render:surface-process -- --quality=ultra --model=coupled --seed=ATLAS-A
npm run render:surface-process -- --style=atlas --quality=high --seed=ATLAS-A
npm run render:surface-process -- --style=relief --quality=high --seed=ATLAS-A
npm run render:surface-process -- --quality=ultra --coast-octaves=5 --presentation-samples=12 --seed=ATLAS-A
npm run render:surface-process -- --map-mode=heightmap --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=climate --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=biomes --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=aridity --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=continentality --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=drainage --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=depressions --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=geomorphology --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=coasts --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --depression-evolution=fill-only --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --large-basin-outlet-scale=0 --map-mode=depressions --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --style=relief --hillslope-diffusion-length-km=0 --valley-relief-scale=0 --seed=ATLAS-A
npm run render:surface-process -- --channel-refinement-scale=0 --coastal-geomorphology-scale=0 --seed=ATLAS-A
npm run render:surface-process -- --map-mode=wind --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=orogeny --quality=preview --seed=ATLAS-A
npm run render:surface-process -- --map-mode=orogeny --flexural-relief-scale=0 --quality=preview --seed=ATLAS-A
npm run review:surface-atlas -- --input=outputs/tectonics/surface-process-world.png
```

The review command preserves native pixels in four regional crops and also writes a compact 2×2 contact sheet. Use it with a 4096×2048 or 8192×4096 atlas before judging coastline hierarchy, river widths, or relief detail from a downscaled whole-world image.

`--style=atlas` is the current aesthetic-development default. It uses a flat pale ocean, a thin ink coastline, categorical climate/elevation colors, and restrained rivers so silhouette and regional composition remain legible. `--style=relief` uses continuous hypsometry, local terrain shading, and a narrow dark shelf ramp. The style choice is presentation-only: it never changes the canonical land mask, elevation, climate, lakes, or drainage network. `--map-mode=depressions` shows retained fill basins in purple, solved lakes in blue, and hybrid spillway incision in orange. `--map-mode=geomorphology` separates continuous valley relief (blue), hillslope erosion (red), and hillslope deposition (green). `--map-mode=coasts` now shows physically decayed active-margin belts, quiet passive-margin support, sedimentary coastal plains, and sediment-scaled classified river mouths. The `orogeny` diagnostic layers blue foreland belts and muted gold outer flexural rises beneath collision, subduction, island-arc, and suture cores. `--depression-evolution=fill-only` is retained as the causal comparison baseline; `hybrid` is the default. Hillslope redistribution defaults to a 42 km physical diffusion length over four bounded passes; `--hillslope-diffusion-length-km=0` disables it. `--continental-relief-scale=0` removes the broad interior-divide pass, `--flexural-relief-scale=0` removes foreland subsidence and outer rise, and `--coastal-plain-scale=0` retains margin classification while removing its relief adjustment. `--valley-relief-scale=0`, `--channel-refinement-scale=0`, and `--coastal-geomorphology-scale=0` provide direct presentation controls. Render options accept both `--name=value` and `--name value` forms.

The implementation roadmap is in [the comprehensive simulator plan](./docs/COMPREHENSIVE_WORLD_SIMULATOR_PLAN.md). The fixed history remains the stable reference, and `simulateMovingCrustSnapshot` remains the exact parcel-remap conformance path. `simulateCoupledTectonicWorld` is the first feedback model: an explicit finite-volume step transports material only across adjacent spherical faces, retains fractional continental and plate mixtures, feeds moved state into later rifting/collision, reports ridge-creation and subduction budgets, and applies area-preserving VOF interface compression to limit long-horizon diffusion. Initial continental lobes remain distinct provenance terranes instead of being flattened into one homogeneous region; their direct elevation influence is deliberately bounded so terrane sutures cannot merge macro-landmasses merely for visual complexity. The evaluator rejects nonlocal parcel transport, fine-only coast noise, insufficient continent hierarchy, oversized dominant landmasses, polar land concentration, and near-circumpolar zonal belts. `createSurfaceProcessWorld` promotes an accepted tectonic state to a nested spherical process mesh and derives a closed drainage graph without changing canonical land topology. Its continuous sampler decouples output resolution from process-cell density; `preview`, `high`, and `ultra` currently mean 2048×1024, 4096×2048, and 8192×4096. High-resolution rendering adds resolved visual detail but intentionally does not invent new continents or alter drainage topology. Surface geology distinguishes crystalline, metamorphic, volcanic, carbonate, sedimentary, and oceanic-basalt units; resistance modulates relief and incision, and both area and eroded volume close by lithology. Reduced atmospheric circulation advects ocean moisture through spherical trade-wind, westerly, and polar belts with edge-length-aware transport, recharge, and uplift loss, so refining the process mesh does not shorten the modeled atmospheric fetch. A deterministic one-level-coarser hydrology graph owns continental divides, outlet succession, depression evolution, and annual lake levels; the fine grid inherits those decisions while refining local channels and presentation. The hybrid geomorphic pass compares discharge and wetness against spillway length, incision cost, lithology, orogenic support, volcanism, cold-basin support, aridity, and the repeated overtopping pressure of large wet basins. It lowers only bounded outlet paths, reruns Priority-Flood before erosion, and performs a second outlet pass on the final diffused terrain so late-forming overflowing lakes cannot survive solely because of operation order. Lake area is solved against open-water evaporation, overflowing lakes retain downstream discharge, closed lakes consume their routed inflow, and total runoff equals ocean outflow plus lake evaporation to floating-point precision. Every resolved lake is exposed as an explicit body record with membership, regime, area, volume, maximum depth, inflow, evaporation, outlet, and structural support. A subsequent conservative hillslope pass moves equal terrain volume along land-only geodesic edges and reroutes drainage. Continuous valley relief then reconstructs narrower sub-cell valleys for rendering without mutating process geography. Rivers follow stable world-space paths whose bend amplitude responds to hierarchy and confinement; mouths end on resolved water boundaries and expose classified delta/estuary/fan geometry. One shared kilometer-scaled present-day margin field now conditions coast spectra, active/passive diagnostics, and a topology-preserving coastal-plain pass. Actual terminal sediment export conditions delta scale, but deltas do not yet accrete process cells or alter sea level. Seasonal circulation, ocean heat transport, lake stratigraphy, persistent rift-age passive margins, and mass-conserving delta-body evolution remain open. The coupled model also still lacks persistent parcel identities through creation/destruction, overlap-area remapping, and plate splits/mergers.

The coupled model is currently calibrated at a 120 Myr production horizon. A 360 Myr stress ensemble still collapses toward one or two dominant supercontinents under the persistent fixed Euler-plate set. Longer histories therefore remain diagnostic until ridge-driven plate birth, subduction-driven retirement, boundary lineage, and plate splits/mergers are implemented.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validate

```bash
npm run typecheck
npm run test:tectonics
npm test
npm run lint
```

The implementation and research-informed product decisions are documented in [DESIGN.md](./DESIGN.md).

## Project status

This is the eighth continent-and-atlas checkpoint. Broad distorted cratonic masses now keep continents cohesive at low exposed-land fractions, candidate selection checks high-sea-level stability, and coast complexity is measured across several scales instead of as one perimeter number. The retained model can be drawn directly into a persistent 4K or 8K browser atlas without rebuilding plates and drainage; downloading that view is optional. A new categorical climate/topographic style keeps terrain classes flat while using a separate segmented mountain mask. Political borders, settlements, labels, authored regional editing, true polar graph topology, and full hydraulic erosion remain intentionally deferred until the base geography is consistently attractive.
