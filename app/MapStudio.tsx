"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderStyle, WorldSettings, WorldStats } from "../lib/world";
import WorldWorker from "../workers/world.worker?worker";

const DEFAULTS: WorldSettings = {
  seed: "VERDANT-047",
  width: 1536,
  height: 768,
  simulationSites: 22000,
  planetScale: 72,
  continentSize: 56,
  seaLevel: 52,
  coastDetail: 84,
  tectonics: 58,
  moisture: 54,
  style: "satellite",
};

const EMPTY_STATS: WorldStats = {
  name: "The Verdant Reach",
  survey: "Temperate archipelago",
  landPercent: 0,
  plateCount: 0,
  riverCount: 0,
  continentSystems: 0,
  coastlineIndex: 0,
  frameClearance: 0,
  largestLandmassPercent: 0,
  oceanGapPercent: 0,
  meanLandmassElongation: 0,
  coastScaleRatio: 0,
  coastHierarchyIndex: 0,
  islandAreaPercent: 0,
  islandSizeDiversity: 0,
  majorLandmassCount: 0,
  effectiveLandmassCount: 0,
  landmassLatitudeDiversity: 0,
  landmassSpacingIrregularity: 0,
  verticalLandmassBias: 0,
  meanMajorLandmassElongation: 0,
  maxSubstantialLandmassElongation: 0,
  landCoreRetention: 0,
  landCoreCoverage: 0,
  neckFragmentation: 0,
  inlandWaterPercent: 0,
  largestInlandWaterPercent: 0,
  circumferenceKm: 0,
  focusLongitude: 0,
  generationMs: 0,
};

type WorkerMessage =
  | { type: "progress"; id: number; stage: string; progress: number }
  | { type: "complete"; id: number; width: number; height: number; pixels: ArrayBuffer; stats: WorldStats }
  | { type: "error"; id: number; message: string }
  | { type: "export-tile"; id: number; y: number; width: number; height: number; pixels: ArrayBuffer }
  | { type: "export-complete"; id: number; width: number; height: number }
  | { type: "export-error"; id: number; message: string };

type ViewMode = "globe" | "atlas";

interface WorldTexture {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

const RESOLUTION_PRESETS = [
  { label: "PREVIEW", width: 1024, height: 512 },
  { label: "HIGH", width: 1536, height: 768 },
  { label: "ULTRA", width: 2048, height: 1024 },
] as const;

const ATLAS_PRESETS = [
  { label: "4K", width: 4096, height: 2048 },
  { label: "8K", width: 8192, height: 4096 },
  { label: "10K", width: 10000, height: 5000 },
] as const;

type AtlasPreset = (typeof ATLAS_PRESETS)[number];

function freshSeed() {
  const words = ["AURELIA", "BRAMBLE", "CERULEAN", "EMBER", "HALCYON", "MISTRAL", "SABLE", "THORN", "VESPER"];
  const word = words[Math.floor(Math.random() * words.length)];
  return `${word}-${Math.floor(100 + Math.random() * 900)}`;
}

function wrap(value: number, period: number) {
  return ((value % period) + period) % period;
}

function planetCircumferenceKm(scale: number) {
  return Math.round((28_000 + 44_000 * (scale / 100)) / 100) * 100;
}

function sameWorldSettings(a: WorldSettings, b: WorldSettings) {
  return a.seed === b.seed
    && a.width === b.width
    && a.height === b.height
    && a.simulationSites === b.simulationSites
    && a.planetScale === b.planetScale
    && a.continentSize === b.continentSize
    && a.seaLevel === b.seaLevel
    && a.coastDetail === b.coastDetail
    && a.tectonics === b.tectonics
    && a.moisture === b.moisture
    && a.style === b.style;
}

function drawAtlas(canvas: HTMLCanvasElement, texture: WorldTexture) {
  canvas.width = texture.width;
  canvas.height = texture.height;
  const context = canvas.getContext("2d");
  context?.putImageData(new ImageData(texture.pixels, texture.width, texture.height), 0, 0);
}

function drawGlobe(
  canvas: HTMLCanvasElement,
  texture: WorldTexture,
  longitude: number,
  latitude: number,
  zoom: number,
  sphereCanvas: HTMLCanvasElement,
  style: RenderStyle,
) {
  canvas.width = texture.width;
  canvas.height = texture.height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  const background = context.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.46,
    0,
    canvas.width * 0.5,
    canvas.height * 0.5,
    canvas.width * 0.62,
  );
  background.addColorStop(0, "#102d36");
  background.addColorStop(0.48, "#071b25");
  background.addColorStop(1, "#031018");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const baseRadius = Math.min(canvas.height * 0.435, canvas.width * 0.255);
  const radius = Math.min(baseRadius * zoom, Math.min(canvas.width, canvas.height) * 0.49);
  const diameter = Math.max(2, Math.ceil(radius * 2 + 4));
  sphereCanvas.width = diameter;
  sphereCanvas.height = diameter;
  const sphereContext = sphereCanvas.getContext("2d");
  if (!sphereContext) return;
  const image = sphereContext.createImageData(diameter, diameter);
  const destination = image.data;
  const cosLongitude = Math.cos(longitude);
  const sinLongitude = Math.sin(longitude);
  const cosLatitude = Math.cos(latitude);
  const sinLatitude = Math.sin(latitude);
  const source = texture.pixels;
  const sourceWidth = texture.width;
  const sourceHeight = texture.height;

  for (let py = 0; py < diameter; py += 1) {
    const screenY = (radius + 2 - (py + 0.5)) / radius;
    for (let px = 0; px < diameter; px += 1) {
      const screenX = (px + 0.5 - radius - 2) / radius;
      const radiusSquared = screenX * screenX + screenY * screenY;
      if (radiusSquared > 1) continue;
      const screenZ = Math.sqrt(1 - radiusSquared);
      const pitchedY = screenY * cosLatitude + screenZ * sinLatitude;
      const pitchedZ = -screenY * sinLatitude + screenZ * cosLatitude;
      const worldX = screenX * cosLongitude + pitchedZ * sinLongitude;
      const worldZ = -screenX * sinLongitude + pitchedZ * cosLongitude;
      const worldLongitude = Math.atan2(worldX, worldZ);
      const worldLatitude = Math.asin(Math.max(-1, Math.min(1, pitchedY)));
      const sourceX = wrap((worldLongitude / (Math.PI * 2) + 0.5) * sourceWidth, sourceWidth);
      const sourceY = Math.max(0, Math.min(sourceHeight - 1, (0.5 - worldLatitude / Math.PI) * (sourceHeight - 1)));
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = (x0 + 1) % sourceWidth;
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      const fx = sourceX - x0;
      const fy = sourceY - y0;
      const topLeft = (y0 * sourceWidth + x0) * 4;
      const topRight = (y0 * sourceWidth + x1) * 4;
      const bottomLeft = (y1 * sourceWidth + x0) * 4;
      const bottomRight = (y1 * sourceWidth + x1) * 4;
      const light = Math.max(0, screenX * -0.34 + screenY * 0.3 + screenZ * 0.88);
      const shade = style === "climate" ? 0.86 + light * 0.16 : 0.68 + light * 0.34;
      const edge = Math.min(1, (1 - radiusSquared) * radius * 0.78);
      const target = (py * diameter + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = source[topLeft + channel] * (1 - fx) + source[topRight + channel] * fx;
        const bottom = source[bottomLeft + channel] * (1 - fx) + source[bottomRight + channel] * fx;
        const sampled = (top * (1 - fy) + bottom * fy) * shade;
        const atmosphere = channel === 0 ? 32 : channel === 1 ? 78 : 96;
        destination[target + channel] = sampled * edge + atmosphere * (1 - edge);
      }
      destination[target + 3] = Math.round(edge * 255);
    }
  }
  sphereContext.putImageData(image, 0, 0);
  context.save();
  context.shadowColor = "rgba(0, 12, 19, 0.9)";
  context.shadowBlur = 34;
  context.shadowOffsetY = 14;
  context.drawImage(sphereCanvas, canvas.width * 0.5 - diameter * 0.5, canvas.height * 0.5 - diameter * 0.5 - 2);
  context.restore();
}

function SettingSlider({
  label,
  value,
  onChange,
  valueLabel,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  valueLabel?: string;
}) {
  return (
    <div className="control-group">
      <div className="control-label"><span>{label}</span><output>{valueLabel ?? `${value}%`}</output></div>
      <input aria-label={label} type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export function MapStudio() {
  const globeCanvasRef = useRef<HTMLCanvasElement>(null);
  const atlasCanvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const atlasRequestRef = useRef(0);
  const atlasTargetRef = useRef<AtlasPreset>(ATLAS_PRESETS[1]);
  const atlasAfterGenerationRef = useRef<AtlasPreset | null>(null);
  const hasDetailedAtlasRef = useRef(false);
  const generatedSeedRef = useRef(DEFAULTS.seed);
  const pendingSettingsRef = useRef<WorldSettings>(DEFAULTS);
  const textureRef = useRef<WorldTexture | null>(null);
  const styleRef = useRef<RenderStyle>(DEFAULTS.style);
  const sphereCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewModeRef = useRef<ViewMode>("globe");
  const zoomRef = useRef(1);
  const rotationRef = useRef({ longitude: -0.38, latitude: -0.12 });
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);
  const [settings, setSettings] = useState(DEFAULTS);
  const [generatedSettings, setGeneratedSettings] = useState<WorldSettings>(DEFAULTS);
  const [renderedStyle, setRenderedStyle] = useState<RenderStyle>(DEFAULTS.style);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [isGenerating, setIsGenerating] = useState(true);
  const [isRenderingAtlas, setIsRenderingAtlas] = useState(false);
  const [atlasTarget, setAtlasTarget] = useState<AtlasPreset>(ATLAS_PRESETS[1]);
  const [pendingAtlasTarget, setPendingAtlasTarget] = useState<AtlasPreset | null>(null);
  const [atlasResolution, setAtlasResolution] = useState({ label: "HIGH", width: DEFAULTS.width, height: DEFAULTS.height });
  const [generationStage, setGenerationStage] = useState("Preparing genesis engine");
  const [progress, setProgress] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("globe");
  const isBusy = isGenerating || isRenderingAtlas;
  const hasPendingWorldChanges = !sameWorldSettings(settings, generatedSettings);
  const hasPendingChanges = hasPendingWorldChanges || pendingAtlasTarget !== null;

  const renderCurrentView = useCallback(() => {
    const texture = textureRef.current;
    if (!texture) return;
    if (viewModeRef.current === "globe") {
      const canvas = globeCanvasRef.current;
      if (!canvas) return;
      sphereCanvasRef.current ??= document.createElement("canvas");
      drawGlobe(canvas, texture, rotationRef.current.longitude, rotationRef.current.latitude, zoomRef.current, sphereCanvasRef.current, styleRef.current);
    } else if (!hasDetailedAtlasRef.current) {
      const canvas = atlasCanvasRef.current;
      if (canvas) drawAtlas(canvas, texture);
    }
  }, []);

  const scheduleRender = useCallback(() => {
    if (animationRef.current !== null) return;
    animationRef.current = requestAnimationFrame(() => {
      animationRef.current = null;
      renderCurrentView();
    });
  }, [renderCurrentView]);

  const requestWorld = useCallback((nextSettings: WorldSettings) => {
    if (!workerRef.current) return;
    const id = ++requestRef.current;
    setIsGenerating(true);
    setProgress(7);
    setGenerationStage("Composing continental terranes");
    setError(null);
    pendingSettingsRef.current = { ...nextSettings };
    workerRef.current.postMessage({ type: "generate", id, settings: nextSettings });
  }, []);

  const startAtlasRender = useCallback((target: AtlasPreset) => {
    if (!workerRef.current || !textureRef.current) return;
    const canvas = atlasCanvasRef.current;
    if (!canvas) return;
    canvas.width = target.width;
    canvas.height = target.height;
    if (!canvas.getContext("2d")) {
      setError(`This browser cannot allocate a ${target.label} atlas canvas.`);
      return;
    }
    hasDetailedAtlasRef.current = true;
    atlasTargetRef.current = target;
    setAtlasTarget(target);
    setAtlasResolution(target);
    viewModeRef.current = "atlas";
    setViewMode("atlas");
    setZoom(1);
    zoomRef.current = 1;
    const id = ++atlasRequestRef.current;
    setIsRenderingAtlas(true);
    setError(null);
    setProgress(1);
    setGenerationStage(`Drawing the ${target.label} atlas in browser`);
    workerRef.current.postMessage({ type: "export", id, width: target.width, height: target.height });
  }, []);

  useEffect(() => {
    const worker = new WorldWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "export-tile") {
        if (message.id !== atlasRequestRef.current) return;
        const canvas = atlasCanvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        context.putImageData(new ImageData(new Uint8ClampedArray(message.pixels), message.width, message.height), 0, message.y);
        setProgress(Math.min(99, Math.round(((message.y + message.height) / atlasTargetRef.current.height) * 100)));
        return;
      }
      if (message.type === "export-complete") {
        if (message.id !== atlasRequestRef.current) return;
        const target = atlasTargetRef.current;
        setAtlasResolution(target);
        setGenerationStage(`${target.label} atlas ready in browser`);
        setProgress(100);
        setPendingAtlasTarget(null);
        setIsRenderingAtlas(false);
        return;
      }
      if (message.type === "export-error") {
        if (message.id !== atlasRequestRef.current) return;
        hasDetailedAtlasRef.current = false;
        setError(message.message);
        setIsRenderingAtlas(false);
        return;
      }
      if (message.id !== requestRef.current) return;
      if (message.type === "progress") {
        setGenerationStage(message.stage);
        setProgress(message.progress);
      } else if (message.type === "complete") {
        const completedSettings = pendingSettingsRef.current;
        textureRef.current = { pixels: new Uint8ClampedArray(message.pixels), width: message.width, height: message.height };
        generatedSeedRef.current = completedSettings.seed;
        styleRef.current = completedSettings.style;
        hasDetailedAtlasRef.current = false;
        setAtlasResolution({ label: "MODEL", width: message.width, height: message.height });
        rotationRef.current.longitude = message.stats.focusLongitude;
        if (atlasCanvasRef.current) drawAtlas(atlasCanvasRef.current, textureRef.current);
        renderCurrentView();
        setGeneratedSettings(completedSettings);
        setRenderedStyle(completedSettings.style);
        setStats(message.stats);
        setProgress(100);
        setIsGenerating(false);
        const queuedAtlas = atlasAfterGenerationRef.current;
        atlasAfterGenerationRef.current = null;
        if (queuedAtlas) startAtlasRender(queuedAtlas);
      } else {
        setError(message.message);
        setIsGenerating(false);
      }
    };
    worker.onerror = () => {
      setError("The terrain worker stopped unexpectedly. Try another seed.");
      setIsGenerating(false);
    };
    requestWorld(DEFAULTS);
    return () => {
      worker.terminate();
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [renderCurrentView, requestWorld, startAtlasRender]);

  const changeViewMode = (mode: ViewMode) => {
    viewModeRef.current = mode;
    setViewMode(mode);
    setZoom(1);
    zoomRef.current = 1;
    scheduleRender();
  };

  const changeZoom = (direction: number) => {
    const next = Math.max(1, Math.min(viewModeRef.current === "globe" ? 1.35 : 2.2, zoomRef.current + direction * 0.2));
    zoomRef.current = next;
    setZoom(next);
    scheduleRender();
  };

  const rotateGlobe = (deltaX: number, deltaY: number) => {
    if (viewModeRef.current !== "globe") return;
    rotationRef.current.longitude += deltaX * 0.0065;
    rotationRef.current.latitude = Math.max(-1.18, Math.min(1.18, rotationRef.current.latitude - deltaY * 0.0065));
    scheduleRender();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (viewMode !== "globe") return;
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const deltaX = event.clientX - dragRef.current.x;
    const deltaY = event.clientY - dragRef.current.y;
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    rotateGlobe(deltaX, deltaY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleMapKey = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (viewMode !== "globe") return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-18, 0],
      ArrowRight: [18, 0],
      ArrowUp: [0, -18],
      ArrowDown: [0, 18],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    rotateGlobe(...direction);
  };

  const updateSetting = <K extends keyof WorldSettings>(key: K, value: WorldSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const selectResolution = (width: number, height: number) => {
    setSettings((current) => ({ ...current, width, height }));
  };

  const selectStyle = (style: RenderStyle) => {
    setSettings((current) => ({ ...current, style }));
  };

  const randomize = () => {
    setSettings((current) => ({ ...current, seed: freshSeed() }));
  };

  const exportMap = () => {
    const canvas = viewModeRef.current === "atlas" ? atlasCanvasRef.current : globeCanvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.download = `${generatedSeedRef.current.toLowerCase()}-${styleRef.current}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    }, "image/png");
  };

  const stageAtlasTarget = (target: AtlasPreset) => {
    setPendingAtlasTarget(target);
  };

  const applyStagedChanges = () => {
    if (isBusy) return;
    if (hasPendingWorldChanges || !textureRef.current) {
      atlasAfterGenerationRef.current = pendingAtlasTarget;
      requestWorld(settings);
    } else if (pendingAtlasTarget) {
      startAtlasRender(pendingAtlasTarget);
    } else {
      requestWorld(settings);
    }
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <div><span className="brand-name">ATLAS FORGE</span><span className="brand-subtitle">PROCEDURAL WORLDS</span></div>
        </div>
        <div className="world-title"><span className="eyebrow">CURRENT WORLD</span><strong>{stats.name.toUpperCase()}</strong></div>
        <div className="topbar-actions">
          <button className="export-button" type="button" onClick={exportMap} disabled={isBusy}>DOWNLOAD VIEW</button>
          <button className={`export-button ${pendingAtlasTarget?.label === "4K" ? "export-primary" : ""}`} type="button" onClick={() => stageAtlasTarget(ATLAS_PRESETS[0])} disabled={isBusy}>STAGE 4K</button>
          <button className={`export-button ${pendingAtlasTarget?.label === "8K" ? "export-primary" : ""}`} type="button" onClick={() => stageAtlasTarget(ATLAS_PRESETS[1])} disabled={isBusy}>STAGE 8K</button>
          <button className={`export-button ${pendingAtlasTarget?.label === "10K" ? "export-primary" : ""}`} type="button" onClick={() => stageAtlasTarget(ATLAS_PRESETS[2])} disabled={isBusy}>STAGE 10K</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel" aria-label="World controls">
          <div className="panel-heading">
            <div><span className="eyebrow">GENESIS ENGINE</span><h1>Shape a world.</h1></div>
            <span className="version">ALPHA 13</span>
          </div>

          <label className="seed-field">
            <span>WORLD SEED</span>
            <span className="seed-entry">
              <input value={settings.seed} maxLength={28} spellCheck="false" onChange={(event) => updateSetting("seed", event.target.value.toUpperCase())} aria-label="World seed" />
              <button type="button" onClick={randomize} aria-label="Randomize world seed" disabled={isBusy}>↻</button>
            </span>
          </label>

          <div className="resolution-section">
            <div className="control-label"><span>MAP RESOLUTION</span><output>{settings.width} × {settings.height}</output></div>
            <div className="resolution-grid">
              {RESOLUTION_PRESETS.map((preset) => {
                const active = settings.width === preset.width && settings.height === preset.height;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className={active ? "active" : ""}
                    onClick={() => selectResolution(preset.width, preset.height)}
                    aria-pressed={active}
                    disabled={isBusy}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="export-section">
            <div className="control-label"><span>OUTPUT ATLAS</span><output>{pendingAtlasTarget ? `${pendingAtlasTarget.width} × ${pendingAtlasTarget.height} STAGED` : `${atlasResolution.width} × ${atlasResolution.height}`}</output></div>
            <div className="export-grid">
              {ATLAS_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  className={(pendingAtlasTarget?.width ?? atlasResolution.width) === preset.width ? "active" : ""}
                  type="button"
                  onClick={() => stageAtlasTarget(preset)}
                  aria-pressed={(pendingAtlasTarget?.width ?? atlasResolution.width) === preset.width}
                  disabled={isBusy}
                >
                  <strong>{preset.label}</strong><span>{preset.width} × {preset.height}</span>
                </button>
              ))}
            </div>
          </div>

          <SettingSlider
            label="PLANET CIRCUMFERENCE"
            value={settings.planetScale ?? 60}
            valueLabel={`${planetCircumferenceKm(settings.planetScale ?? 60).toLocaleString("en-US")} KM`}
            onChange={(value) => updateSetting("planetScale", value)}
          />
          <SettingSlider label="CONTINENT MASS" value={settings.continentSize} onChange={(value) => updateSetting("continentSize", value)} />
          <SettingSlider label="GLOBAL SEA LEVEL" value={settings.seaLevel ?? 52} onChange={(value) => updateSetting("seaLevel", value)} />
          <SettingSlider label="COASTAL COMPLEXITY" value={settings.coastDetail} onChange={(value) => updateSetting("coastDetail", value)} />
          <SettingSlider label="TECTONIC ACTIVITY" value={settings.tectonics} onChange={(value) => updateSetting("tectonics", value)} />
          <SettingSlider label="GLOBAL MOISTURE" value={settings.moisture} onChange={(value) => updateSetting("moisture", value)} />

          <div className="style-section">
            <span className="section-label">RENDERING STYLE</span>
            <div className="style-grid">
              <button className={`style-card ${settings.style === "satellite" ? "active" : ""}`} type="button" onClick={() => selectStyle("satellite")} aria-pressed={settings.style === "satellite"} disabled={isBusy}><i className="satellite-swatch" />Satellite</button>
              <button className={`style-card ${settings.style === "climate" ? "active" : ""}`} type="button" onClick={() => selectStyle("climate")} aria-pressed={settings.style === "climate"} disabled={isBusy}><i className="climate-swatch" />Climate atlas</button>
              <button className={`style-card ${settings.style === "ink" ? "active" : ""}`} type="button" onClick={() => selectStyle("ink")} aria-pressed={settings.style === "ink"} disabled={isBusy}><i className="ink-swatch" />Field ink</button>
            </div>
          </div>

          <button className="generate-button" type="button" onClick={applyStagedChanges} disabled={isBusy}>
            <span>{isBusy ? generationStage.toUpperCase() : hasPendingWorldChanges && pendingAtlasTarget ? "APPLY, GENERATE & RENDER" : hasPendingWorldChanges ? "APPLY SETTINGS & GENERATE" : pendingAtlasTarget ? `RENDER ${pendingAtlasTarget.label} ATLAS` : "GENERATE THIS WORLD"}</span><span aria-hidden="true">{isBusy ? `${progress}%` : "↗"}</span>
          </button>
          <p className={`generation-note ${hasPendingChanges ? "has-pending" : ""}`}>
            {hasPendingChanges ? "CHANGES STAGED · SUBMIT ONCE TO APPLY EVERYTHING" : "WORLD AND OUTPUT SETTINGS ARE CURRENT"}
          </p>
        </aside>

        <div className="map-stage">
          <canvas
            ref={globeCanvasRef}
            className={`world-canvas globe-view ${viewMode === "globe" ? "" : "is-hidden"}`}
            aria-label="Rotatable procedural fantasy planet"
            tabIndex={viewMode === "globe" ? 0 : -1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleMapKey}
          />
          <canvas
            ref={atlasCanvasRef}
            className={`world-canvas atlas-view ${viewMode === "atlas" ? "" : "is-hidden"}`}
            style={{ transform: `scale(${zoom})` }}
            aria-label={`Seamless ${atlasResolution.width} by ${atlasResolution.height} equirectangular fantasy world atlas`}
          />
          <div className={`map-vignette ${renderedStyle === "climate" && viewMode === "atlas" ? "is-flat" : ""}`} />

          <div className="coordinates">{viewMode === "globe" ? "DRAG TO ROTATE" : "EQUIRECTANGULAR"} <span>—</span> {stats.circumferenceKm ? `${stats.circumferenceKm.toLocaleString("en-US")} KM` : "SEAMLESS 360°"}</div>
          <div className="view-switcher" aria-label="Map projection">
            <button type="button" className={viewMode === "globe" ? "active" : ""} onClick={() => changeViewMode("globe")} aria-pressed={viewMode === "globe"}>GLOBE</button>
            <button type="button" className={viewMode === "atlas" ? "active" : ""} onClick={() => changeViewMode("atlas")} aria-pressed={viewMode === "atlas"}>ATLAS</button>
          </div>
          <div className="map-toolbar" aria-label="Map view controls">
            <button type="button" onClick={() => changeZoom(-1)} aria-label="Zoom out">−</button>
            <output>{Math.round(zoom * 100)}%</output>
            <button type="button" onClick={() => changeZoom(1)} aria-label="Zoom in">+</button>
          </div>

          <div className="survey-strip" aria-label="World survey">
            <div><span>LAND</span><strong>{stats.landPercent || "—"}%</strong></div>
            <div><span>MAJOR LANDS</span><strong>{stats.majorLandmassCount || "—"}</strong></div>
            <div><span>HEADWATERS</span><strong>{stats.riverCount || "—"}</strong></div>
            <div><span>GENESIS</span><strong>{stats.generationMs ? `${(stats.generationMs / 1000).toFixed(1)}s` : "—"}</strong></div>
          </div>

          <div className="scale-bar">
            <span>PLANET</span>
            <i />
            <span>{stats.circumferenceKm ? `${(stats.circumferenceKm / 1000).toFixed(1)}K KM CIRC.` : "WORLD SCALE"}</span>
          </div>
          <div className="map-caption"><span className="eyebrow">BIOME SURVEY</span><strong>{stats.survey}</strong></div>

          {isBusy && (
            <div className="generation-overlay" role="status" aria-live="polite">
              <div className="generation-orbit"><span /></div>
              <strong>{generationStage}</strong>
              <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
              <span>{progress}% · {isRenderingAtlas ? `drawing ${atlasTarget.width} × ${atlasTarget.height} into the atlas` : "deterministic from seed"}</span>
            </div>
          )}
          {error && <div className="error-toast" role="alert">{error}</div>}
        </div>
      </section>
    </main>
  );
}
