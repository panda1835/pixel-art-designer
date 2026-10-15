"use client";

import Image from "next/image";
import AboutDialog from "@/app/_components/about-dialog";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  applyUpdatesToHistory,
  createHistoryState,
  HistoryState,
  redoHistory,
  undoHistory,
} from "@/lib/lego/history";
import {
  generateBom,
  bomToCsv,
  getOccupiedStudCount,
  getProjectCoverage,
} from "@/lib/lego/bom";
import {
  generateRowByRowInstructions,
  instructionsToHtml,
} from "@/lib/lego/instructions";
import { DEFAULT_PALETTE, partTypeToDisplayName } from "@/lib/lego/parts";
import { createProject } from "@/lib/lego/project";
import { exportProjectToPng } from "@/lib/lego/exporters";
import {
  loadProjectsFromStorage,
  saveProjectsToStorage,
} from "@/lib/lego/storage";
import {
  CellUpdate,
  LegoProject,
  PartType,
  PlacedPart,
} from "@/lib/lego/types";
import { cellKey } from "@/lib/lego/board";
import {
  exportProjectToPortableText,
  importProjectFromPortableText,
} from "@/lib/lego/portable";

const MIN_GRID_SIZE = 1;
const MAX_GRID_SIZE = 128;

interface EditorModel {
  projects: LegoProject[];
  activeProjectId: string;
  history: HistoryState;
  selectedPart: PartType;
  selectedColorId: string;
  toolMode: "paint" | "erase" | "select";
  zoom: number;
}

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const RESIZE_CORNERS: ResizeCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

interface GridSelection {
  anchor: { x: number; y: number };
  focus: { x: number; y: number };
}

interface SelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export default function Home() {
  const isHydrated = useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [model, setModel] = useState<EditorModel>(buildInitialModel);
  const [selection, setSelection] = useState<GridSelection | null>(null);

  const [newProjectName, setNewProjectName] = useState("New Design");
  const [newWidth, setNewWidth] = useState(32);
  const [newHeight, setNewHeight] = useState(32);

  const [newColorName, setNewColorName] = useState("Custom");
  const [newColorHex, setNewColorHex] = useState("#3b82f6");

  const dragStateRef = useRef({
    active: false,
    action: "paint" as "paint" | "select" | "move" | "resize",
    moveSource: null as {
      selection: GridSelection;
      history: HistoryState;
    } | null,
    anchor: null as { x: number; y: number } | null,
    corner: "bottom-right" as ResizeCorner,
    touched: new Set<string>(),
  });
  const clipboardRef = useRef<Array<Array<PlacedPart | null>>>([]);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const project = model.history.project;
  const paletteById = useMemo(
    () => new Map(project.palette.map((color) => [color.id, color])),
    [project.palette],
  );

  useEffect(() => {
    saveProjectsToStorage(model.projects);
  }, [model.projects]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      ) {
        return;
      }

      const bounds = selection ? getSelectionBounds(selection) : null;
      const key = event.key.toLowerCase();
      const isShortcut = event.metaKey || event.ctrlKey;
      const toolMode =
        key === "p"
          ? "paint"
          : key === "d"
            ? "erase"
            : key === "s"
              ? "select"
              : null;
      if (toolMode && !isShortcut && !event.altKey && !event.isComposing) {
        event.preventDefault();
        if (event.repeat) return;
        endDrag();
        setSelection(null);
        setModel((current) => ({ ...current, toolMode }));
        return;
      }
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (direction && selection && !isShortcut && !event.altKey) {
        event.preventDefault();
        if (dragStateRef.current.active) return;
        const moved = moveSelection(
          model.history,
          selection,
          direction[0],
          direction[1],
        );
        setSelection(moved.selection);
        setModel((current) => ({
          ...current,
          history: moved.history,
          projects: upsertProject(
            current.projects,
            current.activeProjectId,
            moved.history.project,
          ),
        }));
        return;
      }
      if (isShortcut && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (event.ctrlKey && key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (isShortcut && ["c", "x", "v"].includes(key) && bounds) {
        event.preventDefault();

        if (key === "v") {
          const clipboard = clipboardRef.current;
          if (clipboard.length === 0) {
            return;
          }
          const updates = clipboard.flatMap((row, rowOffset) =>
            row.map((next, columnOffset) => ({
              x: bounds.left + columnOffset,
              y: bounds.top + rowOffset,
              next,
            })),
          );
          setModel((current) => {
            const history = applyUpdatesToHistory(
              current.history,
              updates,
              "Paste",
            );
            return history === current.history
              ? current
              : {
                  ...current,
                  history,
                  projects: upsertProject(
                    current.projects,
                    current.activeProjectId,
                    history.project,
                  ),
                };
          });
          return;
        }

        clipboardRef.current = Array.from(
          { length: bounds.bottom - bounds.top + 1 },
          (_, rowOffset) =>
            Array.from(
              { length: bounds.right - bounds.left + 1 },
              (_, columnOffset) => {
                const placement =
                  project.cells[
                    cellKey(bounds.left + columnOffset, bounds.top + rowOffset)
                  ];
                return placement ? { ...placement } : null;
              },
            ),
        );
        if (key === "x") {
          const updates: CellUpdate[] = clipboardRef.current.flatMap(
            (row, rowOffset) =>
              row.map((_, columnOffset) => ({
                x: bounds.left + columnOffset,
                y: bounds.top + rowOffset,
                next: null,
              })),
          );
          setModel((current) => {
            const history = applyUpdatesToHistory(
              current.history,
              updates,
              "Cut",
            );
            return history === current.history
              ? current
              : {
                  ...current,
                  history,
                  projects: upsertProject(
                    current.projects,
                    current.activeProjectId,
                    history.project,
                  ),
                };
          });
        }
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && bounds) {
        event.preventDefault();
        const updates: CellUpdate[] = Array.from(
          { length: bounds.bottom - bounds.top + 1 },
          (_, rowOffset) =>
            Array.from(
              { length: bounds.right - bounds.left + 1 },
              (_, columnOffset) => ({
                x: bounds.left + columnOffset,
                y: bounds.top + rowOffset,
                next: null,
              }),
            ),
        ).flat();
        setModel((current) => {
          const history = applyUpdatesToHistory(
            current.history,
            updates,
            "Clear Selection",
          );
          return history === current.history
            ? current
            : {
                ...current,
                history,
                projects: upsertProject(
                  current.projects,
                  current.activeProjectId,
                  history.project,
                ),
              };
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [project, selection, model.history]);

  useEffect(() => {
    if (!selection) return;

    function clearSelectionOutside(event: PointerEvent) {
      if (event.button !== 0) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".stud-cell.in-selection, .selection-resize-handle")
      ) {
        return;
      }
      setSelection(null);
    }

    document.addEventListener("pointerdown", clearSelectionOutside, true);
    return () =>
      document.removeEventListener("pointerdown", clearSelectionOutside, true);
  }, [selection]);

  const occupiedStuds = useMemo(() => getOccupiedStudCount(project), [project]);
  const coverage = useMemo(() => getProjectCoverage(project), [project]);
  const bom = useMemo(() => generateBom(project), [project]);
  const instructions = useMemo(
    () => generateRowByRowInstructions(project),
    [project],
  );

  const cellSize = Math.max(10, model.zoom);
  const coordinates = useMemo(() => {
    return Array.from(
      { length: project.width * project.height },
      (_, index) => {
        const x = index % project.width;
        const y = Math.floor(index / project.width);
        return { x, y };
      },
    );
  }, [project.width, project.height]);
  const columnIndices = useMemo(
    () => Array.from({ length: project.width }, (_, index) => index + 1),
    [project.width],
  );
  const rowIndices = useMemo(
    () => Array.from({ length: project.height }, (_, index) => index + 1),
    [project.height],
  );

  const selectedColor =
    paletteById.get(model.selectedColorId) ?? project.palette[0];

  if (!isHydrated) {
    return (
      <div className="grid min-h-screen grid-cols-[310px_1fr_350px] [@media(max-width:1280px)]:grid-cols-[300px_1fr] [@media(max-width:1280px)]:grid-rows-[auto_auto] [@media(max-width:980px)]:block" />
    );
  }

  function applySingleCell(x: number, y: number) {
    const key = cellKey(x, y);
    if (dragStateRef.current.touched.has(key)) {
      return;
    }

    dragStateRef.current.touched.add(key);

    setModel((current) => {
      const existing = current.history.project.cells[key] ?? null;
      let nextPlacement: PlacedPart | null;

      if (current.toolMode === "erase") {
        nextPlacement = null;
      } else if (existing && existing.colorId === current.selectedColorId) {
        // Painting over the selected color preserves the existing tile.
        return current;
      } else {
        nextPlacement = {
          partType: current.selectedPart,
          colorId: current.selectedColorId,
        };
      }

      const updates: CellUpdate[] = [{ x, y, next: nextPlacement }];
      const nextHistory = applyUpdatesToHistory(
        current.history,
        updates,
        current.toolMode === "erase" ? "Delete" : "Paint",
      );

      if (nextHistory === current.history) {
        return current;
      }

      return {
        ...current,
        history: nextHistory,
        projects: upsertProject(
          current.projects,
          current.activeProjectId,
          nextHistory.project,
        ),
      };
    });
  }

  function startDrag(x: number, y: number) {
    dragStateRef.current.active = true;
    if (model.toolMode === "select") {
      const bounds = selection ? getSelectionBounds(selection) : null;
      if (
        selection &&
        bounds &&
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top &&
        y <= bounds.bottom
      ) {
        dragStateRef.current.action = "move";
        dragStateRef.current.anchor = { x, y };
        dragStateRef.current.moveSource = { selection, history: model.history };
        return;
      }
      dragStateRef.current.action = "select";
      dragStateRef.current.anchor = { x, y };
      setSelection({ anchor: { x, y }, focus: { x, y } });
      return;
    }

    dragStateRef.current.action = "paint";
    dragStateRef.current.anchor = null;
    dragStateRef.current.touched = new Set<string>();
    applySingleCell(x, y);
  }

  function continueDrag(x: number, y: number, preserveAspectRatio = false) {
    if (!dragStateRef.current.active) {
      return;
    }
    if (dragStateRef.current.action === "resize") {
      const source = dragStateRef.current.moveSource;
      if (source) {
        const offset = dragStateRef.current.anchor;
        const resized = resizeSelection(
          source.history,
          source.selection,
          x - (offset?.x ?? 0),
          y - (offset?.y ?? 0),
          dragStateRef.current.corner,
          preserveAspectRatio,
        );
        setSelection(resized.selection);
        setModel((current) => ({
          ...current,
          history: resized.history,
          projects: upsertProject(
            current.projects,
            current.activeProjectId,
            resized.history.project,
          ),
        }));
      }
      return;
    }
    if (dragStateRef.current.action === "move") {
      const { anchor, moveSource } = dragStateRef.current;
      if (anchor && moveSource) {
        const moved = moveSelection(
          moveSource.history,
          moveSource.selection,
          x - anchor.x,
          y - anchor.y,
        );
        setSelection(moved.selection);
        setModel((current) => ({
          ...current,
          history: moved.history,
          projects: upsertProject(
            current.projects,
            current.activeProjectId,
            moved.history.project,
          ),
        }));
      }
      return;
    }
    if (dragStateRef.current.action === "select") {
      const anchor = dragStateRef.current.anchor;
      if (anchor) {
        setSelection({ anchor, focus: { x, y } });
      }
      return;
    }
    applySingleCell(x, y);
  }

  function endDrag() {
    dragStateRef.current.moveSource = null;
    dragStateRef.current.active = false;
    dragStateRef.current.action = "paint";
    dragStateRef.current.anchor = null;
    dragStateRef.current.touched = new Set<string>();
  }

  function handleSelectProject(projectId: string) {
    setSelection(null);
    setModel((current) => {
      const target = current.projects.find((item) => item.id === projectId);
      if (!target) {
        return current;
      }

      const selectedColorId = target.palette.some(
        (color) => color.id === current.selectedColorId,
      )
        ? current.selectedColorId
        : (target.palette[0]?.id ?? DEFAULT_PALETTE[0].id);

      return {
        ...current,
        activeProjectId: projectId,
        history: createHistoryState(target),
        selectedColorId,
      };
    });
  }

  function handleCreateProject() {
    const width = clampGridSize(newWidth);
    const height = clampGridSize(newHeight);
    const name = newProjectName.trim() || "Untitled Project";

    const nextProject = createProject(width, height, name);

    setModel((current) => ({
      ...current,
      projects: [nextProject, ...current.projects],
      activeProjectId: nextProject.id,
      history: createHistoryState(nextProject),
      selectedColorId: nextProject.palette[0]?.id ?? DEFAULT_PALETTE[0].id,
    }));
  }

  function handleDeleteActiveProject() {
    setModel((current) => {
      const remaining = current.projects.filter(
        (item) => item.id !== current.activeProjectId,
      );
      if (remaining.length === 0) {
        const fallback = createProject(24, 24, "My Lego Art");
        return {
          ...current,
          projects: [fallback],
          activeProjectId: fallback.id,
          history: createHistoryState(fallback),
          selectedColorId: fallback.palette[0]?.id ?? DEFAULT_PALETTE[0].id,
        };
      }

      const nextActive = remaining[0];
      return {
        ...current,
        projects: remaining,
        activeProjectId: nextActive.id,
        history: createHistoryState(nextActive),
        selectedColorId: nextActive.palette[0]?.id ?? DEFAULT_PALETTE[0].id,
      };
    });
  }

  function handleRenameActiveProject(name: string) {
    setModel((current) => {
      const nextProject = {
        ...current.history.project,
        name,
        updatedAt: new Date().toISOString(),
      };

      return {
        ...current,
        history: {
          ...current.history,
          project: nextProject,
        },
        projects: upsertProject(
          current.projects,
          current.activeProjectId,
          nextProject,
        ),
      };
    });
  }

  function handleAddColor() {
    const hex = normalizeHex(newColorHex);
    if (!hex) {
      return;
    }

    const name = newColorName.trim() || "Custom";
    const id = `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

    setModel((current) => {
      const nextProject = {
        ...current.history.project,
        palette: [...current.history.project.palette, { id, name, hex }],
        updatedAt: new Date().toISOString(),
      };

      return {
        ...current,
        selectedColorId: id,
        history: {
          ...current.history,
          project: nextProject,
        },
        projects: upsertProject(
          current.projects,
          current.activeProjectId,
          nextProject,
        ),
      };
    });
  }

  function handleUndo() {
    setModel((current) => {
      const nextHistory = undoHistory(current.history);
      if (nextHistory === current.history) {
        return current;
      }
      return {
        ...current,
        history: nextHistory,
        projects: upsertProject(
          current.projects,
          current.activeProjectId,
          nextHistory.project,
        ),
      };
    });
  }

  function handleRedo() {
    setModel((current) => {
      const nextHistory = redoHistory(current.history);
      if (nextHistory === current.history) {
        return current;
      }
      return {
        ...current,
        history: nextHistory,
        projects: upsertProject(
          current.projects,
          current.activeProjectId,
          nextHistory.project,
        ),
      };
    });
  }

  function handleExportPng() {
    const dataUrl = exportProjectToPng(project, {
      studSize: 36,
      showGrid: true,
      backgroundColor: "#ffffff",
    });
    downloadDataUrl(`${slugify(project.name)}.png`, dataUrl);
  }

  function handleExportBomCsv() {
    const csv = bomToCsv(bom);
    downloadTextFile(
      `${slugify(project.name)}-bom.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
  }

  function handleExportInstructionsJson() {
    downloadTextFile(
      `${slugify(project.name)}-instructions.json`,
      JSON.stringify(instructions, null, 2),
      "application/json;charset=utf-8",
    );
  }

  function handleExportInstructionsHtml() {
    const html = instructionsToHtml(project, instructions);
    downloadTextFile(
      `${slugify(project.name)}-instructions.html`,
      html,
      "text/html;charset=utf-8",
    );
  }

  function handleExportProjectTxt() {
    const content = exportProjectToPortableText(project);
    downloadTextFile(
      `${slugify(project.name)}.txt`,
      content,
      "text/plain;charset=utf-8",
    );
  }

  function handleImportFilePick() {
    importFileRef.current?.click();
  }

  async function handleImportProjectTxt(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const imported = importProjectFromPortableText(text);

      setModel((current) => {
        const projectToLoad = resolveImportedProject(
          imported,
          current.projects,
        );
        return {
          ...current,
          projects: [projectToLoad, ...current.projects],
          activeProjectId: projectToLoad.id,
          history: createHistoryState(projectToLoad),
          selectedColorId:
            projectToLoad.palette[0]?.id ?? DEFAULT_PALETTE[0].id,
        };
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not import project file.";
      window.alert(message);
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-[310px_1fr_350px] [@media(max-width:1280px)]:grid-cols-[300px_1fr] [@media(max-width:1280px)]:grid-rows-[auto_auto] [@media(max-width:980px)]:block">
      <aside className="grid content-start gap-4 overflow-auto bg-[color-mix(in_oklab,#f7f2e7_92%,white)] p-4 border-r border-[#cbd5c1]">
        <div className="flex items-center gap-3">
          <Image
            className="shrink-0 rounded-sm"
            src="/logo.svg"
            alt="Brick heart logo"
            width={56}
            height={56}
            priority
          />
          <div>
            <h1 className="text-[1.35rem] tracking-[0.01em]">
              Pixel Art Designer
            </h1>
          </div>
        </div>
        <div className="grid justify-items-start gap-1">
          <p className="text-[0.82rem] text-[#57534e]">
            Create pixel art and brick mosaics with custom grids. Export PNG
            images, parts lists, and building instructions.
          </p>
          <AboutDialog />
        </div>

        <section className="grid gap-2.5 rounded-xl border border-[#cbd5c1] bg-white p-3">
          <h2 className="text-[0.94rem] tracking-[0.08em] text-[#57534e] uppercase">
            Projects
          </h2>
          <div className="grid gap-2">
            <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
              Name
              <input
                className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Project name"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
                Width
                <input
                  className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
                  type="number"
                  min={MIN_GRID_SIZE}
                  max={MAX_GRID_SIZE}
                  value={newWidth}
                  onChange={(event) => setNewWidth(Number(event.target.value))}
                />
              </label>
              <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
                Height
                <input
                  className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
                  type="number"
                  min={MIN_GRID_SIZE}
                  max={MAX_GRID_SIZE}
                  value={newHeight}
                  onChange={(event) => setNewHeight(Number(event.target.value))}
                />
              </label>
            </div>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleCreateProject}
            >
              Create Project
            </button>
          </div>

          <div className="grid max-h-42.5 gap-1.5 overflow-auto">
            {model.projects.map((item) => (
              <button
                key={item.id}
                className={
                  item.id === model.activeProjectId
                    ? "flex cursor-pointer items-center justify-between rounded-lg bg-[#e7dfcf] px-3 py-2 text-[#1c1917] transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60 border-2 border-[#0f766e]"
                    : "flex cursor-pointer items-center justify-between rounded-lg bg-[#e7dfcf] px-3 py-2 text-[#1c1917] transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60 border border-[#cbd5c1]"
                }
                onClick={() => handleSelectProject(item.id)}
              >
                <span>{item.name}</span>
                <small>
                  {item.width}x{item.height}
                </small>
              </button>
            ))}
          </div>
          <button
            className="cursor-pointer rounded-lg border border-transparent bg-[#b91c1c] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleDeleteActiveProject}
          >
            Delete Active Project
          </button>
        </section>

        <section className="grid gap-2.5 rounded-xl border border-[#cbd5c1] bg-white p-3">
          <h2 className="text-[0.94rem] tracking-[0.08em] text-[#57534e] uppercase">
            Colors
          </h2>
          <div className="grid grid-cols-2 gap-1.5">
            {project.palette.map((color) => (
              <button
                key={color.id}
                className={
                  model.selectedColorId === color.id
                    ? "flex cursor-pointer items-center gap-1.75 rounded-lg border border-[#cbd5c1] bg-white p-1.5 text-[#1c1917] transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60 outline-2 outline-[#0f172a] outline-offset-1"
                    : "flex cursor-pointer items-center gap-1.75 rounded-lg border border-[#cbd5c1] bg-white p-1.5 text-[#1c1917] transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
                }
                onClick={() =>
                  setModel((current) => ({
                    ...current,
                    selectedColorId: color.id,
                  }))
                }
                title={`${color.name} (${color.hex})`}
              >
                <span
                  className="h-4.5 w-4.5 rounded-full border border-[rgba(0,0,0,0.3)]"
                  style={{ backgroundColor: color.hex }}
                />
                <small className="text-[0.72rem]">{color.name}</small>
              </button>
            ))}
          </div>

          <div className="grid gap-2">
            <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
              Color Name
              <input
                className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
                value={newColorName}
                onChange={(event) => setNewColorName(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
              Hex
              <input
                className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
                value={newColorHex}
                onChange={(event) => setNewColorHex(event.target.value)}
              />
            </label>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleAddColor}
            >
              Add Color
            </button>
          </div>
        </section>

        <section className="grid gap-2.5 rounded-xl border border-[#cbd5c1] bg-white p-3">
          <h2 className="text-[0.94rem] tracking-[0.08em] text-[#57534e] uppercase">
            Exports
          </h2>
          <div className="grid gap-2">
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleExportPng}
            >
              Export PNG
            </button>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleExportBomCsv}
            >
              Export BOM (CSV)
            </button>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleExportInstructionsJson}
            >
              Export Instructions (JSON)
            </button>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleExportInstructionsHtml}
            >
              Export Instructions (HTML)
            </button>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleExportProjectTxt}
            >
              Export Project (TXT)
            </button>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleImportFilePick}
            >
              Import Project (TXT)
            </button>
            <input
              className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
              ref={importFileRef}
              type="file"
              accept=".txt,application/json,text/plain"
              onChange={handleImportProjectTxt}
              hidden
            />
          </div>
        </section>
      </aside>

      <main
        className="grid min-w-0 grid-rows-[auto_1fr]"
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <div className="flex items-center gap-3 overflow-x-auto border-b border-[#cbd5c1] bg-[color-mix(in_oklab,white_94%,#ebe5d8)] px-4 py-3 text-[0.86rem]">
          <strong>{project.name}</strong>
          <span>
            {project.width}x{project.height} studs
          </span>
          <span>{occupiedStuds} placed</span>
          {model.toolMode === "select" ? (
            <span>
              Drag to select; use arrow keys or drag inside the box to move.
              Drag any corner handle to resize; hold Shift to preserve
              proportions.
            </span>
          ) : null}
          <span>{(coverage * 100).toFixed(1)}% coverage</span>
          {selectedColor ? (
            <span className="inline-flex items-center gap-1.5">
              <i
                className="inline-block h-3 w-3 rounded-full border border-[rgba(0,0,0,0.3)]"
                style={{ backgroundColor: selectedColor.hex }}
              />
              {selectedColor.name}
            </span>
          ) : null}
        </div>

        <div className="overflow-auto p-4 [@media(max-width:980px)]:p-2.5">
          <div className="grid w-max grid-cols-[34px_max-content] grid-rows-[34px_max-content]">
            <div className="sticky top-0 left-0 z-4 border border-r-0 border-b-0 border-[#94a3b8] bg-[#e5e7eb]" />
            <div
              className="sticky top-0 z-3 grid border border-b-0 border-l-0 border-[#94a3b8] bg-[#e5e7eb]"
              style={{
                gridTemplateColumns: `repeat(${project.width}, ${cellSize}px)`,
              }}
            >
              {columnIndices.map((column) => (
                <span
                  key={`col-${column}`}
                  className="grid place-items-center overflow-hidden border-r border-b border-[rgba(148,163,184,0.5)] text-[0.65rem] leading-none whitespace-nowrap text-[#334155] tabular-nums select-none"
                >
                  {shouldShowAxisMarker(column) ? column : ""}
                </span>
              ))}
            </div>
            <div
              className="sticky left-0 z-3 grid border border-t-0 border-r-0 border-[#94a3b8] bg-[#e5e7eb]"
              style={{
                gridTemplateRows: `repeat(${project.height}, ${cellSize}px)`,
              }}
            >
              {rowIndices.map((row) => (
                <span
                  key={`row-${row}`}
                  className="grid place-items-center overflow-hidden border-r border-b border-[rgba(148,163,184,0.5)] text-[0.65rem] leading-none whitespace-nowrap text-[#334155] tabular-nums select-none"
                >
                  {shouldShowAxisMarker(row) ? row : ""}
                </span>
              ))}
            </div>
            <div
              data-board-surface
              className="relative -mt-px -ml-px w-max touch-none"
              onPointerMove={(event) => {
                if (!dragStateRef.current.active) return;
                const rect = event.currentTarget.getBoundingClientRect();
                continueDrag(
                  Math.max(
                    0,
                    Math.min(
                      project.width - 1,
                      Math.floor((event.clientX - rect.left - 1) / cellSize),
                    ),
                  ),
                  Math.max(
                    0,
                    Math.min(
                      project.height - 1,
                      Math.floor((event.clientY - rect.top - 1) / cellSize),
                    ),
                  ),
                  event.shiftKey,
                );
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
            >
              <div
                className="grid w-max border border-[#94a3b8] shadow-[0_10px_40px_rgba(2,6,23,0.12)]"
                style={{
                  gridTemplateColumns: `repeat(${project.width}, ${cellSize}px)`,
                  gridTemplateRows: `repeat(${project.height}, ${cellSize}px)`,
                }}
              >
                {coordinates.map(({ x, y }) => {
                  const placement = project.cells[cellKey(x, y)] ?? null;
                  const color = placement
                    ? paletteById.get(placement.colorId)
                    : null;
                  const bounds = selection
                    ? getSelectionBounds(selection)
                    : null;
                  const isSelected =
                    bounds !== null &&
                    x >= bounds.left &&
                    x <= bounds.right &&
                    y >= bounds.top &&
                    y <= bounds.bottom;
                  const isCorner =
                    bounds &&
                    isSelected &&
                    (x === bounds.left || x === bounds.right) &&
                    (y === bounds.top || y === bounds.bottom);
                  const selectionEdges =
                    isSelected && bounds
                      ? [
                          y === bounds.top && "border-t-2 border-t-[#0f766e]",
                          x === bounds.right && "border-r-2 border-r-[#0f766e]",
                          y === bounds.bottom &&
                            "border-b-2 border-b-[#0f766e]",
                          x === bounds.left && "border-l-2 border-l-[#0f766e]",
                        ]
                          .filter(Boolean)
                          .join(" ")
                      : "";

                  return (
                    <button
                      key={`${x}-${y}`}
                      className={`grid h-full w-full place-items-center rounded-none border border-[rgba(148,163,184,0.45)] bg-[#f3f6fb] p-0 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] ${isSelected ? `relative z-1 shadow-[inset_0_0_0_2px_#0f766e] ${selectionEdges}${model.toolMode === "select" ? " cursor-move" : " cursor-pointer"}` : "cursor-pointer"}`}
                      style={{
                        backgroundColor: placement
                          ? (color?.hex ?? "#111827")
                          : undefined,
                        zIndex: isCorner ? 2 : undefined,
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.focus({ preventScroll: true });
                        event.currentTarget
                          .closest("[data-board-surface]")
                          ?.setPointerCapture(event.pointerId);
                        startDrag(x, y);
                      }}
                      title={`(${x + 1}, ${y + 1})`}
                    >
                      {model.toolMode === "select" &&
                        selection &&
                        bounds &&
                        RESIZE_CORNERS.map((corner) => {
                          const isLeft = corner.endsWith("left");
                          const isTop = corner.startsWith("top");
                          if (
                            x !== (isLeft ? bounds.left : bounds.right) ||
                            y !== (isTop ? bounds.top : bounds.bottom)
                          )
                            return null;
                          return (
                            <span
                              key={corner}
                              className="pointer-events-auto absolute z-5 h-4 w-4 min-w-0 touch-none rounded-[3px] border-2 border-white bg-[#0f766e] p-0 hover:bg-[#115e59]"
                              aria-label={`Resize selection from ${corner} corner`}
                              title={`Drag ${corner} corner to resize`}
                              style={{
                                left: isLeft ? -2 : undefined,
                                right: isLeft ? undefined : -2,
                                top: isTop ? -2 : undefined,
                                bottom: isTop ? undefined : -2,
                                transform: `translate(${isLeft ? "-50%" : "50%"}, ${isTop ? "-50%" : "50%"})`,
                                cursor:
                                  isLeft === isTop
                                    ? "nwse-resize"
                                    : "nesw-resize",
                              }}
                              onPointerDown={(event) => {
                                if (event.button !== 0) return;
                                event.preventDefault();
                                event.stopPropagation();
                                event.currentTarget
                                  .closest("[data-board-surface]")
                                  ?.setPointerCapture(event.pointerId);
                                dragStateRef.current.active = true;
                                dragStateRef.current.action = "resize";
                                dragStateRef.current.corner = corner;
                                dragStateRef.current.anchor = {
                                  x: isLeft ? bounds.left : bounds.right,
                                  y: isTop ? bounds.top : bounds.bottom,
                                };
                                // Preserve the grab offset so a click alone never changes size.
                                const board = event.currentTarget.closest(
                                  "[data-board-surface]",
                                )!;
                                const rect = board.getBoundingClientRect();
                                dragStateRef.current.anchor = {
                                  x:
                                    Math.floor(
                                      (event.clientX - rect.left - 1) /
                                        cellSize,
                                    ) - dragStateRef.current.anchor.x,
                                  y:
                                    Math.floor(
                                      (event.clientY - rect.top - 1) / cellSize,
                                    ) - dragStateRef.current.anchor.y,
                                };
                                dragStateRef.current.moveSource = {
                                  selection,
                                  history: model.history,
                                };
                              }}
                            />
                          );
                        })}
                      {placement ? (
                        <span
                          className={
                            placement.partType === "tile_1x1_round"
                              ? "h-[90%] w-[90%] rounded-full border border-[rgba(15,23,42,0.22)]"
                              : placement.partType === "tile_1x1_square"
                                ? "h-full w-full rounded-[3px] border border-[rgba(15,23,42,0.22)]"
                                : "relative h-full w-full rounded-[1px] border border-[rgba(15,23,42,0.22)] after:absolute after:top-1/2 after:left-1/2 after:h-[35%] after:w-[35%] after:rounded-full after:bg-[rgba(255,255,255,0.35)] after:content-['']"
                          }
                          style={{ backgroundColor: color?.hex ?? "#111827" }}
                        />
                      ) : (
                        <span className="h-[22%] w-[22%] rounded-full bg-[rgba(100,116,139,0.24)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>

      <aside className="grid content-start gap-4 overflow-auto bg-[color-mix(in_oklab,#f7f2e7_92%,white)] p-4 border-l border-[#cbd5c1] [@media(max-width:1280px)]:col-span-full [@media(max-width:1280px)]:border-t [@media(max-width:1280px)]:border-l-0">
        <section className="grid gap-2.5 rounded-xl border border-[#cbd5c1] bg-white p-3">
          <h2 className="text-[0.94rem] tracking-[0.08em] text-[#57534e] uppercase">
            Editor
          </h2>
          <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
            Active Name
            <input
              className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
              value={project.name}
              onChange={(event) =>
                handleRenameActiveProject(event.target.value)
              }
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <button
              title="Paint (P)"
              aria-keyshortcuts="p"
              className={`cursor-pointer rounded-lg text-sm border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60 ${model.toolMode === "paint" ? "outline-2 outline-[#0f172a] outline-offset-1" : ""}`}
              onClick={() => {
                endDrag();
                setSelection(null);
                setModel((current) => ({ ...current, toolMode: "paint" }));
              }}
            >
              Paint (P)
            </button>
            <button
              title="Delete (D)"
              aria-keyshortcuts="d"
              className={`cursor-pointer rounded-lg text-sm  border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60 ${model.toolMode === "erase" ? "outline-2 outline-[#0f172a] outline-offset-1" : ""}`}
              onClick={() => {
                endDrag();
                setSelection(null);
                setModel((current) => ({ ...current, toolMode: "erase" }));
              }}
            >
              Delete (D)
            </button>
            <button
              title="Select (S)"
              aria-keyshortcuts="s"
              className={`cursor-pointer text-sm rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60 ${model.toolMode === "select" ? "outline-2 outline-[#0f172a] outline-offset-1" : ""}`}
              onClick={() => {
                endDrag();
                setSelection(null);
                setModel((current) => ({ ...current, toolMode: "select" }));
              }}
            >
              Select (S)
            </button>
          </div>

          <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
            Part Type
            <select
              className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
              value={model.selectedPart}
              onChange={(event) =>
                setModel((current) => ({
                  ...current,
                  selectedPart: event.target.value as PartType,
                }))
              }
            >
              <option value="plate_1x1">1x1 Plate</option>
              <option value="tile_1x1_square">1x1 Square Tile</option>
              <option value="tile_1x1_round">1x1 Round Tile</option>
            </select>
          </label>

          <label className="grid gap-1.5 text-[0.78rem] text-[#57534e]">
            Zoom ({cellSize}px)
            <input
              className="w-full rounded-lg border border-[#cbd5c1] bg-white p-2 text-[#1c1917]"
              type="range"
              min={10}
              max={42}
              value={model.zoom}
              onChange={(event) =>
                setModel((current) => ({
                  ...current,
                  zoom: Number(event.target.value),
                }))
              }
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={model.history.past.length === 0}
              onClick={handleUndo}
            >
              Undo
            </button>
            <button
              className="cursor-pointer rounded-lg border border-transparent bg-[#0f766e] px-3 py-2 text-white transition-[background-color] duration-120 ease-[ease] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={model.history.future.length === 0}
              onClick={handleRedo}
            >
              Redo
            </button>
          </div>
        </section>

        <section className="grid gap-2.5 rounded-xl border border-[#cbd5c1] bg-white p-3">
          <h2 className="text-[0.94rem] tracking-[0.08em] text-[#57534e] uppercase">
            Bill of Materials
          </h2>
          <div className="grid gap-1">
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-[#cbd5c1] pb-1 text-[0.8rem] font-bold">
              <span>Part</span>
              <span>Color</span>
              <span>Count</span>
            </div>
            {bom.map((item) => (
              <div
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-[0.8rem]"
                key={`${item.partType}-${item.colorId}`}
              >
                <span>{partTypeToDisplayName(item.partType)}</span>
                <span className="inline-flex items-center gap-1.5">
                  <i
                    className="inline-block h-3 w-3 rounded-full border border-[rgba(0,0,0,0.3)]"
                    style={{ backgroundColor: item.colorHex }}
                  />
                  {item.colorId}
                </span>
                <span>{item.count}</span>
              </div>
            ))}
            {bom.length === 0 ? (
              <p className="text-[0.82rem] text-[#57534e]">
                No parts placed yet.
              </p>
            ) : null}
          </div>
        </section>

        <section className="grid gap-2.5 rounded-xl border border-[#cbd5c1] bg-white p-3">
          <h2 className="text-[0.94rem] tracking-[0.08em] text-[#57534e] uppercase">
            Instructions
          </h2>
          <p className="text-[0.82rem] text-[#57534e]">
            Row-by-row build steps.
          </p>
          <div className="grid max-h-105 gap-2 overflow-auto">
            {instructions.slice(0, 100).map((step) => (
              <article
                key={step.stepNumber}
                className="rounded-lg border border-[#cbd5c1] bg-white p-2"
              >
                <h3 className="text-[0.88rem]">
                  Step {step.stepNumber}: {step.title}
                </h3>
                <p>{step.cells.length} parts</p>
              </article>
            ))}
            {instructions.length > 100 ? (
              <p className="text-[0.82rem] text-[#57534e]">
                Showing first 100 steps. Export JSON/HTML for full instructions.
              </p>
            ) : null}
            {instructions.length === 0 ? (
              <p className="text-[0.82rem] text-[#57534e]">
                No instructions generated yet.
              </p>
            ) : null}
          </div>
        </section>
      </aside>
    </div>
  );
}

function buildInitialModel(): EditorModel {
  const fallback = createProject(24, 24, "My Lego Art");

  if (typeof window === "undefined") {
    return {
      projects: [fallback],
      activeProjectId: fallback.id,
      history: createHistoryState(fallback),
      selectedPart: "plate_1x1",
      selectedColorId: fallback.palette[0]?.id ?? DEFAULT_PALETTE[0].id,
      toolMode: "paint",
      zoom: 24,
    };
  }

  const stored = loadProjectsFromStorage();
  const firstProject = stored[0] ?? fallback;
  const projects = stored.length > 0 ? stored : [fallback];

  return {
    projects,
    activeProjectId: firstProject.id,
    history: createHistoryState(firstProject),
    selectedPart: "plate_1x1",
    selectedColorId: firstProject.palette[0]?.id ?? DEFAULT_PALETTE[0].id,
    toolMode: "paint",
    zoom: 24,
  };
}

function upsertProject(
  projects: LegoProject[],
  id: string,
  project: LegoProject,
): LegoProject[] {
  const index = projects.findIndex((item) => item.id === id);

  if (index < 0) {
    return [project, ...projects];
  }

  const next = [...projects];
  next[index] = project;
  return next;
}

function resolveImportedProject(
  project: LegoProject,
  existing: LegoProject[],
): LegoProject {
  const existingIds = new Set(existing.map((item) => item.id));
  const existingNames = new Set(existing.map((item) => item.name));
  const next = { ...project };

  if (existingIds.has(next.id)) {
    next.id = crypto.randomUUID();
  }

  if (existingNames.has(next.name)) {
    next.name = `${next.name} (Imported)`;
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/(^-|-$)/g, "") || "lego-art"
  );
}

function downloadTextFile(
  filename: string,
  content: string,
  contentType: string,
) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(filename, url, true);
}

function downloadDataUrl(
  filename: string,
  url: string,
  revokeAfterDownload = false,
) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  if (revokeAfterDownload) {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function normalizeHex(value: string): string | null {
  const cleaned = value.trim();
  if (!/^#([a-fA-F0-9]{6})$/.test(cleaned)) {
    return null;
  }
  return cleaned.toLowerCase();
}

function clampGridSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 24;
  }
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(value)));
}

function shouldShowAxisMarker(value: number): boolean {
  return value === 1 || value % 5 === 0;
}

function moveSelection(
  history: HistoryState,
  selection: GridSelection,
  dx: number,
  dy: number,
) {
  const bounds = getSelectionBounds(selection);
  dx = Math.max(
    -bounds.left,
    Math.min(dx, history.project.width - 1 - bounds.right),
  );
  dy = Math.max(
    -bounds.top,
    Math.min(dy, history.project.height - 1 - bounds.bottom),
  );
  if (dx === 0 && dy === 0) return { history, selection };

  // Build final values once per cell so overlapping moves undo correctly.
  const updates = new Map<string, CellUpdate>();
  const placements: CellUpdate[] = [];
  for (let y = bounds.top; y <= bounds.bottom; y++) {
    for (let x = bounds.left; x <= bounds.right; x++) {
      const part = history.project.cells[cellKey(x, y)];
      if (part) {
        updates.set(cellKey(x, y), { x, y, next: null });
        placements.push({ x: x + dx, y: y + dy, next: part });
      }
    }
  }
  for (const placement of placements) {
    updates.set(cellKey(placement.x, placement.y), placement);
  }
  return {
    history: applyUpdatesToHistory(
      history,
      [...updates.values()],
      "Move Selection",
    ),
    selection: {
      anchor: { x: selection.anchor.x + dx, y: selection.anchor.y + dy },
      focus: { x: selection.focus.x + dx, y: selection.focus.y + dy },
    },
  };
}

// Sample the original selection on every preview to avoid cumulative scaling loss.
function resizeSelection(
  history: HistoryState,
  selection: GridSelection,
  x: number,
  y: number,
  corner: ResizeCorner,
  preserveAspectRatio = false,
) {
  const bounds = getSelectionBounds(selection);
  let left = corner.endsWith("left")
    ? Math.max(0, Math.min(bounds.right, x))
    : bounds.left;
  let top = corner.startsWith("top")
    ? Math.max(0, Math.min(bounds.bottom, y))
    : bounds.top;
  let right = corner.endsWith("right")
    ? Math.max(bounds.left, Math.min(history.project.width - 1, x))
    : bounds.right;
  let bottom = corner.startsWith("bottom")
    ? Math.max(bounds.top, Math.min(history.project.height - 1, y))
    : bounds.bottom;
  const sourceWidth = bounds.right - bounds.left + 1;
  const sourceHeight = bounds.bottom - bounds.top + 1;
  if (preserveAspectRatio) {
    const isLeft = corner.endsWith("left");
    const isTop = corner.startsWith("top");
    const maxWidth = isLeft
      ? bounds.right + 1
      : history.project.width - bounds.left;
    const maxHeight = isTop
      ? bounds.bottom + 1
      : history.project.height - bounds.top;
    // Project the pointer onto the original diagonal, then clamp both axes together.
    const scale = Math.min(
      maxWidth / sourceWidth,
      maxHeight / sourceHeight,
      Math.max(
        1 / sourceWidth,
        1 / sourceHeight,
        ((right - left + 1) * sourceWidth + (bottom - top + 1) * sourceHeight) /
          (sourceWidth ** 2 + sourceHeight ** 2),
      ),
    );
    const scaledWidth = Math.max(1, Math.round(sourceWidth * scale));
    const scaledHeight = Math.max(1, Math.round(sourceHeight * scale));
    left = isLeft ? bounds.right - scaledWidth + 1 : bounds.left;
    right = isLeft ? bounds.right : bounds.left + scaledWidth - 1;
    top = isTop ? bounds.bottom - scaledHeight + 1 : bounds.top;
    bottom = isTop ? bounds.bottom : bounds.top + scaledHeight - 1;
  }
  if (
    left === bounds.left &&
    top === bounds.top &&
    right === bounds.right &&
    bottom === bounds.bottom
  )
    return { history, selection };

  const width = right - left + 1;
  const height = bottom - top + 1;
  const updates = new Map<string, CellUpdate>();
  for (let y = bounds.top; y <= bounds.bottom; y++) {
    for (let x = bounds.left; x <= bounds.right; x++) {
      updates.set(cellKey(x, y), { x, y, next: null });
    }
  }
  // Nearest-neighbor image scaling keeps the palette and part shapes intact.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX =
        bounds.left +
        Math.min(
          sourceWidth - 1,
          Math.floor(((x + 0.5) * sourceWidth) / width),
        );
      const sourceY =
        bounds.top +
        Math.min(
          sourceHeight - 1,
          Math.floor(((y + 0.5) * sourceHeight) / height),
        );
      const targetX = left + x;
      const targetY = top + y;
      updates.set(cellKey(targetX, targetY), {
        x: targetX,
        y: targetY,
        next: history.project.cells[cellKey(sourceX, sourceY)] ?? null,
      });
    }
  }
  return {
    history: applyUpdatesToHistory(
      history,
      [...updates.values()],
      "Resize Selection",
    ),
    selection: { anchor: { x: left, y: top }, focus: { x: right, y: bottom } },
  };
}

function getSelectionBounds(selection: GridSelection): SelectionBounds {
  return {
    left: Math.min(selection.anchor.x, selection.focus.x),
    top: Math.min(selection.anchor.y, selection.focus.y),
    right: Math.max(selection.anchor.x, selection.focus.x),
    bottom: Math.max(selection.anchor.y, selection.focus.y),
  };
}

function subscribeNoop() {
  return () => {};
}

function getServerSnapshot() {
  return false;
}

function getClientSnapshot() {
  return true;
}
