import { cellKey } from "@/lib/lego/board";
import { PartType, LegoProject } from "@/lib/lego/types";

interface PngRenderOptions {
  studSize: number;
  gridColor?: string;
  backgroundColor?: string;
  showGrid?: boolean;
}

export function renderProjectToCanvas(
  project: LegoProject,
  options: PngRenderOptions
): HTMLCanvasElement {
  const {
    studSize,
    gridColor = "#d1d5db",
    backgroundColor = "#ffffff",
    showGrid = true,
  } = options;

  const width = project.width * studSize;
  const height = project.height * studSize;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create canvas context");
  }

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);

  const palette = new Map(project.palette.map((color) => [color.id, color.hex]));

  for (let y = 0; y < project.height; y += 1) {
    for (let x = 0; x < project.width; x += 1) {
      const part = project.cells[cellKey(x, y)];
      if (!part) {
        if (showGrid) {
          drawEmptyStud(context, x, y, studSize, gridColor);
        }
        continue;
      }

      const fillColor = palette.get(part.colorId) ?? "#000000";
      context.fillStyle = fillColor;
      context.fillRect(x * studSize, y * studSize, studSize, studSize);
      drawPlacedPart(context, x, y, studSize, part.partType, fillColor);

      if (showGrid) {
        context.strokeStyle = "rgba(15, 23, 42, 0.18)";
        context.lineWidth = 1;
        context.strokeRect(x * studSize, y * studSize, studSize, studSize);
      }
    }
  }

  return canvas;
}

export function exportProjectToPng(
  project: LegoProject,
  options: PngRenderOptions
): string {
  const canvas = renderProjectToCanvas(project, options);
  return canvas.toDataURL("image/png");
}

function drawEmptyStud(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  studSize: number,
  gridColor: string
) {
  const originX = x * studSize;
  const originY = y * studSize;

  context.strokeStyle = gridColor;
  context.lineWidth = 1;
  context.strokeRect(originX, originY, studSize, studSize);

  context.fillStyle = "rgba(148, 163, 184, 0.2)";
  context.beginPath();
  context.arc(
    originX + studSize / 2,
    originY + studSize / 2,
    studSize * 0.16,
    0,
    Math.PI * 2
  );
  context.fill();
}

function drawPlacedPart(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  studSize: number,
  partType: PartType,
  fillColor: string
) {
  const originX = x * studSize;
  const originY = y * studSize;
  const centerX = originX + studSize / 2;
  const centerY = originY + studSize / 2;

  context.fillStyle = fillColor;

  if (partType === "tile_1x1_square") {
    const padding = 0;
    context.fillRect(
      originX + padding,
      originY + padding,
      studSize - padding * 2,
      studSize - padding * 2
    );
    return;
  }

  if (partType === "tile_1x1_round") {
    context.beginPath();
    context.arc(centerX, centerY, studSize * 0.4, 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.fillRect(originX + 1, originY + 1, studSize - 2, studSize - 2);
  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.beginPath();
  context.arc(centerX, centerY, studSize * 0.2, 0, Math.PI * 2);
  context.fill();
}
