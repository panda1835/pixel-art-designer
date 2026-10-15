import { DEFAULT_PALETTE } from "@/lib/lego/parts";
import { validateProject } from "@/lib/lego/project";
import { LegoProject, StoredProjects } from "@/lib/lego/types";

const STORAGE_KEY = "lego-art-projects-v1";

export function loadProjectsFromStorage(): LegoProject[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as StoredProjects;
    if (!Array.isArray(parsed.projects)) {
      return [];
    }

    return parsed.projects
      .filter((project) => validateProject(project))
      .map((project) => migrateLegacyPalette(project));
  } catch {
    return [];
  }
}

export function saveProjectsToStorage(projects: LegoProject[]): void {
  const payload: StoredProjects = {
    version: 1,
    projects,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

const LEGACY_PALETTE_IDS = [
  "black",
  "white",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "tan",
  "brown",
  "gray",
];

const NUMBERED_PALETTE_IDS = [
  "01-trang",
  "02-cam",
  "03-mau-hong",
  "04-xanh-la-cay",
  "05-den",
  "06-do",
  "07-vang",
  "08-xanh-dam",
  "09-deep-green",
  "10-hoa-hong-do",
  "11-mau-be",
  "12-xam-nhat",
  "13-xanh-lam-nhat",
  "14-xam-dam",
  "15-nau",
  "16-tim",
  "17-vang-nhat",
  "18-tim-nhat",
  "19-tron-mau",
  "20-xanh-lam",
];

const LEGACY_COLOR_TO_NEW_ID: Record<string, string> = {
  black: "black",
  white: "white",
  red: "red",
  orange: "orange",
  yellow: "yellow",
  green: "leaf-green",
  blue: "dark-blue",
  purple: "purple",
  pink: "pink",
  tan: "beige",
  brown: "brown",
  gray: "dark-gray",
};

function migrateLegacyPalette(project: LegoProject): LegoProject {
  const paletteIds = project.palette.map((color) => color.id).sort();
  const legacyExpected = [...LEGACY_PALETTE_IDS].sort();
  const numberedExpected = [...NUMBERED_PALETTE_IDS].sort();
  const isLegacyPalette =
    paletteIds.length === legacyExpected.length &&
    paletteIds.every((id, index) => id === legacyExpected[index]);
  const isNumberedPalette =
    paletteIds.length === numberedExpected.length &&
    paletteIds.every((id, index) => id === numberedExpected[index]);

  if (!isLegacyPalette && !isNumberedPalette) {
    return project;
  }

  const nextCells = { ...project.cells };
  for (const key of Object.keys(nextCells)) {
    const existing = nextCells[key];
    const mappedColorId = LEGACY_COLOR_TO_NEW_ID[existing.colorId];
    if (mappedColorId) {
      nextCells[key] = {
        ...existing,
        colorId: mappedColorId,
      };
    }
  }

  if (isNumberedPalette) {
    remapProjectCells(nextCells, {
      "01-trang": "white",
      "02-cam": "orange",
      "03-mau-hong": "pink",
      "04-xanh-la-cay": "leaf-green",
      "05-den": "black",
      "06-do": "red",
      "07-vang": "yellow",
      "08-xanh-dam": "dark-blue",
      "09-deep-green": "deep-green",
      "10-hoa-hong-do": "rose-red",
      "11-mau-be": "beige",
      "12-xam-nhat": "light-gray",
      "13-xanh-lam-nhat": "light-blue",
      "14-xam-dam": "dark-gray",
      "15-nau": "brown",
      "16-tim": "purple",
      "17-vang-nhat": "light-yellow",
      "18-tim-nhat": "light-purple",
      "19-tron-mau": "mixed",
      "20-xanh-lam": "cyan",
    });
  }

  return {
    ...project,
    palette: DEFAULT_PALETTE,
    cells: nextCells,
    updatedAt: new Date().toISOString(),
  };
}

function remapProjectCells(
  cells: LegoProject["cells"],
  map: Record<string, string>
): void {
  for (const key of Object.keys(cells)) {
    const existing = cells[key];
    const mappedColorId = map[existing.colorId];
    if (mappedColorId) {
      cells[key] = {
        ...existing,
        colorId: mappedColorId,
      };
    }
  }
}
