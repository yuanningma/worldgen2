import {
  generateWorldModel,
  renderCartographicStrip,
  type WorldModel,
  type WorldSettings,
} from "../lib/world";

type IncomingMessage =
  | { type?: "generate"; id: number; settings: WorldSettings }
  | { type: "export"; id: number; width: number; height: number };

let latestModel: WorldModel | null = null;

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  const { id } = message;
  try {
    if (message.type === "export") {
      if (!latestModel) throw new Error("Generate a world before exporting a high-resolution atlas");
      const stripHeight = 128;
      for (let y = 0; y < message.height; y += stripHeight) {
        const height = Math.min(stripHeight, message.height - y);
        const pixels = renderCartographicStrip(latestModel, message.width, message.height, y, height);
        self.postMessage(
          { type: "export-tile", id, y, width: message.width, height, pixels: pixels.buffer },
          { transfer: [pixels.buffer] },
        );
      }
      self.postMessage({ type: "export-complete", id, width: message.width, height: message.height });
      return;
    }

    latestModel = generateWorldModel(message.settings, (stage, progress) => {
      self.postMessage({ type: "progress", id, stage, progress });
    });
    const displayPixels = latestModel.pixels.slice();
    self.postMessage(
      {
        type: "complete",
        id,
        width: latestModel.width,
        height: latestModel.height,
        pixels: displayPixels.buffer,
        stats: latestModel.stats,
      },
      { transfer: [displayPixels.buffer] },
    );
  } catch (error) {
    self.postMessage({
      type: message.type === "export" ? "export-error" : "error",
      id,
      message: error instanceof Error ? error.message : "World generation failed",
    });
  }
};
