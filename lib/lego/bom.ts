import { parseCellKey } from "@/lib/lego/board";
import { partTypeToDisplayName } from "@/lib/lego/parts";
import { BomLineItem, LegoProject } from "@/lib/lego/types";

export function generateBom(project: LegoProject): BomLineItem[] {
  const paletteById = new Map(project.palette.map((color) => [color.id, color.hex]));
  const counts = new Map<string, BomLineItem>();

  for (const part of Object.values(project.cells)) {
    const key = `${part.partType}|${part.colorId}`;
    const existing = counts.get(key);

    if (!existing) {
      counts.set(key, {
        partType: part.partType,
        colorId: part.colorId,
        colorHex: paletteById.get(part.colorId) ?? "#000000",
        count: 1,
      });
      continue;
    }

    existing.count += 1;
  }

  return [...counts.values()].sort((a, b) => {
    if (a.partType !== b.partType) {
      return a.partType.localeCompare(b.partType);
    }
    return a.colorId.localeCompare(b.colorId);
  });
}

export function bomToCsv(rows: BomLineItem[]): string {
  const header = "part_type,part_name,color_id,color_hex,count";
  const data = rows.map((row) => {
    const partName = partTypeToDisplayName(row.partType);
    return `${row.partType},${csvEscape(partName)},${row.colorId},${row.colorHex},${row.count}`;
  });

  return [header, ...data].join("\n");
}

export function getOccupiedStudCount(project: LegoProject): number {
  return Object.keys(project.cells).length;
}

export function getProjectCoverage(project: LegoProject): number {
  const total = project.width * project.height;
  if (total === 0) {
    return 0;
  }

  return getOccupiedStudCount(project) / total;
}

export function getSortedCells(project: LegoProject): Array<{
  x: number;
  y: number;
  partType: string;
  colorId: string;
}> {
  return Object.entries(project.cells)
    .map(([key, value]) => {
      const { x, y } = parseCellKey(key);
      return {
        x,
        y,
        partType: value.partType,
        colorId: value.colorId,
      };
    })
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function csvEscape(value: string): string {
  const escaped = value.replaceAll('"', '""');
  return `"${escaped}"`;
}
