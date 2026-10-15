import { PaletteColor, PartType } from "@/lib/lego/types";

export const SCHEMA_VERSION = 1;

export const DEFAULT_PALETTE: PaletteColor[] = [
  { id: "white", name: "White", hex: "#f8fafc" },
  { id: "orange", name: "Orange", hex: "#f27a2a" },
  { id: "pink", name: "Pink", hex: "#e8b2dd" },
  { id: "leaf-green", name: "Leaf Green", hex: "#2f8e4a" },
  { id: "black", name: "Black", hex: "#1c1f22" },
  { id: "red", name: "Red", hex: "#c7352e" },
  { id: "yellow", name: "Yellow", hex: "#f0d22d" },
  { id: "dark-blue", name: "Dark Blue", hex: "#1f4ea8" },
  { id: "deep-green", name: "Deep Green", hex: "#216a45" },
  { id: "rose-red", name: "Rose Red", hex: "#bf3f69" },
  { id: "beige", name: "Beige", hex: "#e9d0b1" },
  { id: "light-gray", name: "Light Gray", hex: "#c2c7ce" },
  { id: "light-blue", name: "Light Blue", hex: "#6ea7df" },
  { id: "dark-gray", name: "Dark Gray", hex: "#525861" },
  { id: "brown", name: "Brown", hex: "#5a3f29" },
  { id: "purple", name: "Purple", hex: "#5f3cae" },
  { id: "light-yellow", name: "Light Yellow", hex: "#e4d8a8" },
  { id: "light-purple", name: "Light Purple", hex: "#a88cdd" },
  { id: "mixed", name: "Mixed", hex: "#9fa68d" },
  { id: "cyan", name: "Cyan", hex: "#39b6c8" },
];

export const PART_LABELS: Record<PartType, string> = {
  plate_1x1: "1x1 Plate",
  tile_1x1_square: "1x1 Square Tile",
  tile_1x1_round: "1x1 Round Tile",
};

export function partTypeToDisplayName(partType: PartType): string {
  return PART_LABELS[partType];
}
