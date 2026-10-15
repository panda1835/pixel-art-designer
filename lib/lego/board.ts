import {
  CellDiff,
  CellMap,
  CellUpdate,
  EditorCommand,
  LegoProject,
  PlacedPart,
} from "@/lib/lego/types";

export function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

export function parseCellKey(key: string): { x: number; y: number } {
  const [xString, yString] = key.split(":");
  return {
    x: Number(xString),
    y: Number(yString),
  };
}

export function getCell(cells: CellMap, x: number, y: number): PlacedPart | null {
  return cells[cellKey(x, y)] ?? null;
}

export function isInBounds(project: LegoProject, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < project.width && y < project.height;
}

export function applyCellUpdates(
  project: LegoProject,
  updates: CellUpdate[],
  label: string
): { project: LegoProject; command: EditorCommand | null } {
  if (updates.length === 0) {
    return { project, command: null };
  }

  const nextCells = { ...project.cells };
  const diffs: CellDiff[] = [];

  for (const update of updates) {
    if (!isInBounds(project, update.x, update.y)) {
      continue;
    }

    const key = cellKey(update.x, update.y);
    const previous = nextCells[key] ?? null;

    if (isSamePlacement(previous, update.next)) {
      continue;
    }

    diffs.push({
      x: update.x,
      y: update.y,
      previous,
      next: update.next,
    });

    if (update.next === null) {
      delete nextCells[key];
    } else {
      nextCells[key] = update.next;
    }
  }

  if (diffs.length === 0) {
    return { project, command: null };
  }

  const command: EditorCommand = {
    id: crypto.randomUUID(),
    label,
    diffs,
    timestamp: new Date().toISOString(),
  };

  return {
    project: {
      ...project,
      cells: nextCells,
      updatedAt: command.timestamp,
    },
    command,
  };
}

export function applyCommand(project: LegoProject, command: EditorCommand): LegoProject {
  const nextCells = { ...project.cells };

  for (const diff of command.diffs) {
    const key = cellKey(diff.x, diff.y);
    if (diff.next === null) {
      delete nextCells[key];
    } else {
      nextCells[key] = diff.next;
    }
  }

  return {
    ...project,
    cells: nextCells,
    updatedAt: new Date().toISOString(),
  };
}

export function revertCommand(project: LegoProject, command: EditorCommand): LegoProject {
  const nextCells = { ...project.cells };

  for (const diff of command.diffs) {
    const key = cellKey(diff.x, diff.y);
    if (diff.previous === null) {
      delete nextCells[key];
    } else {
      nextCells[key] = diff.previous;
    }
  }

  return {
    ...project,
    cells: nextCells,
    updatedAt: new Date().toISOString(),
  };
}

function isSamePlacement(a: PlacedPart | null, b: PlacedPart | null): boolean {
  if (a === null && b === null) {
    return true;
  }

  if (a === null || b === null) {
    return false;
  }

  return a.partType === b.partType && a.colorId === b.colorId;
}
