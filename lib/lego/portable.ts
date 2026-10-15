import { cloneProject, validateProject } from "@/lib/lego/project";
import { LegoProject } from "@/lib/lego/types";

interface PortablePayloadV1 {
  format: "lego-art-project-v1";
  exportedAt: string;
  project: LegoProject;
}

export function exportProjectToPortableText(project: LegoProject): string {
  const payload: PortablePayloadV1 = {
    format: "lego-art-project-v1",
    exportedAt: new Date().toISOString(),
    project,
  };

  return JSON.stringify(payload, null, 2);
}

export function importProjectFromPortableText(text: string): LegoProject {
  let payload: PortablePayloadV1;

  try {
    payload = JSON.parse(text) as PortablePayloadV1;
  } catch {
    throw new Error("Invalid text file. Could not parse JSON.");
  }

  if (payload.format !== "lego-art-project-v1") {
    throw new Error("Unsupported file format.");
  }

  if (!validateProject(payload.project)) {
    throw new Error("File does not contain a valid project.");
  }

  return cloneProject(payload.project);
}
