export type PartType = "plate_1x1" | "tile_1x1_square" | "tile_1x1_round";

export interface PaletteColor {
  id: string;
  name: string;
  hex: string;
}

export interface PlacedPart {
  partType: PartType;
  colorId: string;
}

export type CellMap = Record<string, PlacedPart>;

export interface LegoProject {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  width: number;
  height: number;
  palette: PaletteColor[];
  cells: CellMap;
}

export interface CellUpdate {
  x: number;
  y: number;
  next: PlacedPart | null;
}

export interface CellDiff {
  x: number;
  y: number;
  previous: PlacedPart | null;
  next: PlacedPart | null;
}

export interface EditorCommand {
  id: string;
  label: string;
  diffs: CellDiff[];
  timestamp: string;
}

export interface BomLineItem {
  partType: PartType;
  colorId: string;
  colorHex: string;
  count: number;
}

export interface InstructionStep {
  stepNumber: number;
  title: string;
  cells: Array<{
    x: number;
    y: number;
    partType: PartType;
    colorId: string;
  }>;
}

export interface StoredProjects {
  version: number;
  projects: LegoProject[];
}
