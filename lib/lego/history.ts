import {
  applyCommand,
  applyCellUpdates,
  revertCommand,
} from "@/lib/lego/board";
import { CellUpdate, EditorCommand, LegoProject } from "@/lib/lego/types";

export interface HistoryState {
  project: LegoProject;
  past: EditorCommand[];
  future: EditorCommand[];
}

export function createHistoryState(project: LegoProject): HistoryState {
  return {
    project,
    past: [],
    future: [],
  };
}

export function applyUpdatesToHistory(
  state: HistoryState,
  updates: CellUpdate[],
  label: string
): HistoryState {
  const result = applyCellUpdates(state.project, updates, label);
  if (!result.command) {
    return state;
  }

  return {
    project: result.project,
    past: [...state.past, result.command],
    future: [],
  };
}

export function undoHistory(state: HistoryState): HistoryState {
  const last = state.past.at(-1);
  if (!last) {
    return state;
  }

  const previousProject = revertCommand(state.project, last);
  return {
    project: previousProject,
    past: state.past.slice(0, -1),
    future: [last, ...state.future],
  };
}

export function redoHistory(state: HistoryState): HistoryState {
  const next = state.future[0];
  if (!next) {
    return state;
  }

  const nextProject = applyCommand(state.project, next);
  return {
    project: nextProject,
    past: [...state.past, next],
    future: state.future.slice(1),
  };
}
