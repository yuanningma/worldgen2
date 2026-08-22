import { generateWorld, type WorldSettings } from "../lib/world";

type IncomingMessage = { id: number; settings: WorldSettings };

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const { id, settings } = event.data;
  try {
    const result = generateWorld(settings, (stage, progress) => {
      self.postMessage({ type: "progress", id, stage, progress });
    });
    self.postMessage(
      {
        type: "complete",
        id,
        width: result.width,
        height: result.height,
        pixels: result.pixels.buffer,
        stats: result.stats,
      },
      { transfer: [result.pixels.buffer] },
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : "World generation failed",
    });
  }
};
