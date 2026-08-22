"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderStyle, WorldSettings, WorldStats } from "../lib/world";
import WorldWorker from "../workers/world.worker?worker";

const DEFAULTS: WorldSettings = {
  seed: "VERDANT-047",
  width: 1008,
  height: 630,
  continentSize: 56,
  coastDetail: 76,
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
  coastlineIndex: 0,
  frameClearance: 0,
  generationMs: 0,
};

type WorkerMessage =
  | { type: "progress"; id: number; stage: string; progress: number }
  | { type: "complete"; id: number; width: number; height: number; pixels: ArrayBuffer; stats: WorldStats }
  | { type: "error"; id: number; message: string };

function freshSeed() {
  const words = ["AURELIA", "BRAMBLE", "CERULEAN", "EMBER", "HALCYON", "MISTRAL", "SABLE", "THORN", "VESPER"];
  const word = words[Math.floor(Math.random() * words.length)];
  return `${word}-${Math.floor(100 + Math.random() * 900)}`;
}

function SettingSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="control-group">
      <div className="control-label"><span>{label}</span><output>{value}%</output></div>
      <input aria-label={label} type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export function MapStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const [settings, setSettings] = useState(DEFAULTS);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [isGenerating, setIsGenerating] = useState(true);
  const [generationStage, setGenerationStage] = useState("Preparing genesis engine");
  const [progress, setProgress] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const requestWorld = useCallback((nextSettings: WorldSettings) => {
    if (!workerRef.current) return;
    const id = ++requestRef.current;
    setIsGenerating(true);
    setProgress(7);
    setGenerationStage("Dividing tectonic plates");
    setError(null);
    workerRef.current.postMessage({ id, settings: nextSettings });
  }, []);

  useEffect(() => {
    const worker = new WorldWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== requestRef.current) return;
      if (message.type === "progress") {
        setGenerationStage(message.stage);
        setProgress(message.progress);
      } else if (message.type === "complete") {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (canvas && context) {
          canvas.width = message.width;
          canvas.height = message.height;
          const data = new Uint8ClampedArray(message.pixels);
          context.putImageData(new ImageData(data, message.width, message.height), 0, 0);
        }
        setStats(message.stats);
        setProgress(100);
        setIsGenerating(false);
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
    return () => worker.terminate();
  }, [requestWorld]);

  const updateSetting = <K extends keyof WorldSettings>(key: K, value: WorldSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const selectStyle = (style: RenderStyle) => {
    const next = { ...settings, style };
    setSettings(next);
    requestWorld(next);
  };

  const randomize = () => {
    const next = { ...settings, seed: freshSeed() };
    setSettings(next);
    requestWorld(next);
  };

  const exportMap = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.download = `${settings.seed.toLowerCase()}-${settings.style}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    }, "image/png");
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <div><span className="brand-name">ATLAS FORGE</span><span className="brand-subtitle">PROCEDURAL WORLDS</span></div>
        </div>
        <div className="world-title"><span className="eyebrow">CURRENT WORLD</span><strong>{stats.name.toUpperCase()}</strong></div>
        <button className="export-button" type="button" onClick={exportMap} disabled={isGenerating}>EXPORT PNG</button>
      </header>

      <section className="workspace">
        <aside className="control-panel" aria-label="World controls">
          <div className="panel-heading">
            <div><span className="eyebrow">GENESIS ENGINE</span><h1>Shape a world.</h1></div>
            <span className="version">ALPHA 01</span>
          </div>

          <label className="seed-field">
            <span>WORLD SEED</span>
            <span className="seed-entry">
              <input value={settings.seed} maxLength={28} spellCheck="false" onChange={(event) => updateSetting("seed", event.target.value.toUpperCase())} aria-label="World seed" />
              <button type="button" onClick={randomize} aria-label="Randomize world seed">↻</button>
            </span>
          </label>

          <SettingSlider label="CONTINENT MASS" value={settings.continentSize} onChange={(value) => updateSetting("continentSize", value)} />
          <SettingSlider label="COASTAL COMPLEXITY" value={settings.coastDetail} onChange={(value) => updateSetting("coastDetail", value)} />
          <SettingSlider label="TECTONIC ACTIVITY" value={settings.tectonics} onChange={(value) => updateSetting("tectonics", value)} />
          <SettingSlider label="GLOBAL MOISTURE" value={settings.moisture} onChange={(value) => updateSetting("moisture", value)} />

          <div className="style-section">
            <span className="section-label">RENDERING STYLE</span>
            <div className="style-grid">
              <button className={`style-card ${settings.style === "satellite" ? "active" : ""}`} type="button" onClick={() => selectStyle("satellite")} aria-pressed={settings.style === "satellite"}><i className="satellite-swatch" />Satellite</button>
              <button className={`style-card ${settings.style === "ink" ? "active" : ""}`} type="button" onClick={() => selectStyle("ink")} aria-pressed={settings.style === "ink"}><i className="ink-swatch" />Field ink</button>
            </div>
          </div>

          <button className="generate-button" type="button" onClick={() => requestWorld(settings)} disabled={isGenerating}>
            <span>{isGenerating ? generationStage.toUpperCase() : "GENERATE THIS WORLD"}</span><span aria-hidden="true">{isGenerating ? `${progress}%` : "↗"}</span>
          </button>
          <p className="generation-note">Voronoi plates · elevation · watersheds · biomes</p>
        </aside>

        <div className="map-stage">
          <canvas
            ref={canvasRef}
            className="world-canvas"
            style={{ transform: `scale(${zoom})` }}
            aria-label="Procedurally generated satellite-style fantasy world"
          />
          <div className="map-vignette" />

          <div className="coordinates">34° N · 118° E <span>—</span> 1:42M</div>
          <div className="map-toolbar" aria-label="Map view controls">
            <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.2))} aria-label="Zoom out">−</button>
            <output>{Math.round(zoom * 100)}%</output>
            <button type="button" onClick={() => setZoom((value) => Math.min(2.2, value + 0.2))} aria-label="Zoom in">+</button>
          </div>

          <div className="survey-strip" aria-label="World survey">
            <div><span>LAND</span><strong>{stats.landPercent || "—"}%</strong></div>
            <div><span>PLATES</span><strong>{stats.plateCount || "—"}</strong></div>
            <div><span>HEADWATERS</span><strong>{stats.riverCount || "—"}</strong></div>
            <div><span>GENESIS</span><strong>{stats.generationMs ? `${(stats.generationMs / 1000).toFixed(1)}s` : "—"}</strong></div>
          </div>

          <div className="scale-bar"><span>0</span><i /><span>1,000 KM</span></div>
          <div className="map-caption"><span className="eyebrow">BIOME SURVEY</span><strong>{stats.survey}</strong></div>

          {isGenerating && (
            <div className="generation-overlay" role="status" aria-live="polite">
              <div className="generation-orbit"><span /></div>
              <strong>{generationStage}</strong>
              <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
              <span>{progress}% · deterministic from seed</span>
            </div>
          )}
          {error && <div className="error-toast" role="alert">{error}</div>}
        </div>
      </section>
    </main>
  );
}
