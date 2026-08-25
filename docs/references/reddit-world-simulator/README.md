# External world-simulator reference set

These images were supplied by the project owner on 2026-08-24 from a Reddit post about a similar procedural world simulator. The original post URL, author, repository, and license were not supplied. Rights remain with the original creator. Keep this directory as an internal product and scientific-design reference; do not present these images as Atlas Forge output or copy their artwork into shipped assets.

The useful guiding principle is the product architecture: one coherent spherical planet observed through causal and diagnostic layers. We should reproduce capabilities from our own simulation, not reproduce the pictured world.

## Files and the idea each demonstrates

- `01-biomes.png` — detailed categorical biomes, marine zones, ice, and coastal classes.
- `02-aridity-index.png` — a continuous diagnostic behind categorical vegetation.
- `03-settlement-suitability.png` — a downstream synthesis layer; deliberately deferred until physical layers are trustworthy.
- `04-plate-mosaic-and-motion.png` — plate ownership, boundary regimes, and motion vectors over the canonical coast.
- `05-mean-annual-temperature.png` — continuous annual temperature with latitude, elevation, and land effects.
- `06-mean-annual-precipitation.png` — continuous moisture circulation and rain-shadow structure.
- `07-seasonal-temperature-range.png` — continentality and maritime moderation.
- `08-drainage-area.png` — a dense hierarchical drainage diagnostic rather than only selected large rivers.
- `09-ocean-currents-and-sst.png` — wind-driven surface circulation and transported heat.
- `10-seasonal-temperature.png` — four seasonal temperature states.
- `11-seasonal-precipitation.png` — four seasonal precipitation states.
- `12-pressure-and-prevailing-winds.png` — pressure anomalies and directional winds.
- `13-physical-relief-rivers-lakes.png` — the main presentation target: readable relief, shelves, lakes, and dense rivers.
- `14-globe-views.png` — multiple views of the same seamless spherical authority.

## Scope decisions

Build now:

- canonical height and bathymetry;
- plate, boundary, lithology, and elevation diagnostics;
- resolved drainage, rivers, and lakes;
- annual temperature, moisture transport, precipitation, aridity, and biomes;
- synchronized atlas and globe observations of the same world.

Build after those layers are calibrated:

- seasonal pressure and climate;
- wind-driven ocean circulation and sea-surface-temperature transport;
- civilization and settlement suitability.

