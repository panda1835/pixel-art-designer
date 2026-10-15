import { parseCellKey } from "@/lib/lego/board";
import { partTypeToDisplayName } from "@/lib/lego/parts";
import { InstructionStep, LegoProject } from "@/lib/lego/types";

export function generateRowByRowInstructions(project: LegoProject): InstructionStep[] {
  const rows = new Map<number, InstructionStep["cells"]>();

  for (const [key, value] of Object.entries(project.cells)) {
    const { x, y } = parseCellKey(key);
    const rowCells = rows.get(y) ?? [];

    rowCells.push({
      x,
      y,
      partType: value.partType,
      colorId: value.colorId,
    });

    rows.set(y, rowCells);
  }

  const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);

  return sortedRows.map(([rowIndex, cells], index) => {
    const sortedCells = [...cells].sort((a, b) => a.x - b.x);
    return {
      stepNumber: index + 1,
      title: `Build row ${rowIndex + 1}`,
      cells: sortedCells,
    };
  });
}

export function instructionsToHtml(project: LegoProject, steps: InstructionStep[]): string {
  const now = new Date().toLocaleString();

  const rows = steps
    .map((step) => {
      const summary = step.cells
        .map((cell) => `(${cell.x + 1}, ${cell.y + 1}) ${partTypeToDisplayName(cell.partType)} ${cell.colorId}`)
        .join("<br/>");
      return `<h3>Step ${step.stepNumber}: ${step.title}</h3><p>${summary}</p>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(project.name)} - Build Instructions</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #111827; }
  h1 { margin-bottom: 4px; }
  p.meta { color: #6b7280; margin-top: 0; }
  h3 { margin-top: 20px; margin-bottom: 8px; }
  p { margin: 0; line-height: 1.5; }
</style>
</head>
<body>
  <h1>${escapeHtml(project.name)} - Build Instructions</h1>
  <p class="meta">${project.width}x${project.height} studs • Generated ${escapeHtml(now)}</p>
  ${rows || "<p>No placed parts in this project.</p>"}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
