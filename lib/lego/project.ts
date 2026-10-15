import { DEFAULT_PALETTE, SCHEMA_VERSION } from "@/lib/lego/parts";
import { LegoProject } from "@/lib/lego/types";

export function createProject(
  width: number,
  height: number,
  name = "Untitled Project"
): LegoProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    width,
    height,
    palette: DEFAULT_PALETTE,
    cells: {},
  };
}

export function cloneProject(project: LegoProject): LegoProject {
  return {
    ...project,
    palette: [...project.palette],
    cells: { ...project.cells },
  };
}

export function validateProject(project: LegoProject): boolean {
  if (!project.id || !project.name) {
    return false;
  }

  if (!Number.isInteger(project.width) || !Number.isInteger(project.height)) {
    return false;
  }

  if (project.width < 1 || project.height < 1) {
    return false;
  }

  return true;
}
