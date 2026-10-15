"use client";

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
    action: "paint" as "paint" | "select" | "move",
    moveSource: null as { selection: GridSelection; history: HistoryState } | null,
    anchor: null as { x: number; y: number } | null,
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
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (direction && selection && !isShortcut && !event.altKey) {
        event.preventDefault();
        if (dragStateRef.current.active) return;
        const moved = moveSelection(model.history, selection, direction[0], direction[1]);
        setSelection(moved.selection);
        setModel((current) => ({
          ...current,
          history: moved.history,
          projects: upsertProject(current.projects, current.activeProjectId, moved.history.project),
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
    return <div className="app-shell" />;
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
        // Quick erase in paint mode when clicking the currently selected color.
        nextPlacement = null;
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
        current.toolMode === "erase" ? "Erase" : "Paint",
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
      if (selection && bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
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

  function continueDrag(x: number, y: number) {
    if (!dragStateRef.current.active) {
      return;
    }
    if (dragStateRef.current.action === "move") {
      const { anchor, moveSource } = dragStateRef.current;
      if (anchor && moveSource) {
        const moved = moveSelection(moveSource.history, moveSource.selection, x - anchor.x, y - anchor.y);
        setSelection(moved.selection);
        setModel((current) => ({
          ...current,
          history: moved.history,
          projects: upsertProject(current.projects, current.activeProjectId, moved.history.project),
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
    <div className="app-shell">
      <aside className="panel left-panel">
        <h1>Lego Art Designer</h1>
        <p className="subtle">
          Design 2D patterns with custom grid sizes and exportable build
          outputs.
        </p>

        <section>
          <h2>Projects</h2>
          <div className="stacked-form">
            <label>
              Name
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Project name"
              />
            </label>
            <div className="two-col-inputs">
              <label>
                Width
                <input
                  type="number"
                  min={MIN_GRID_SIZE}
                  max={MAX_GRID_SIZE}
                  value={newWidth}
                  onChange={(event) => setNewWidth(Number(event.target.value))}
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  min={MIN_GRID_SIZE}
                  max={MAX_GRID_SIZE}
                  value={newHeight}
                  onChange={(event) => setNewHeight(Number(event.target.value))}
                />
              </label>
            </div>
            <button onClick={handleCreateProject}>Create Project</button>
          </div>

          <div className="project-list">
            {model.projects.map((item) => (
              <button
                key={item.id}
                className={
                  item.id === model.activeProjectId
                    ? "project-item active"
                    : "project-item"
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
          <button className="danger" onClick={handleDeleteActiveProject}>
            Delete Active Project
          </button>
        </section>

        <section>
          <h2>Colors</h2>
          <div className="palette-grid">
            {project.palette.map((color) => (
              <button
                key={color.id}
                className={
                  model.selectedColorId === color.id
                    ? "color-chip selected"
                    : "color-chip"
                }
                onClick={() =>
                  setModel((current) => ({
                    ...current,
                    selectedColorId: color.id,
                  }))
                }
                title={`${color.name} (${color.hex})`}
              >
                <span style={{ backgroundColor: color.hex }} />
                <small>{color.name}</small>
              </button>
            ))}
          </div>

          <div className="stacked-form">
            <label>
              Color Name
              <input
                value={newColorName}
                onChange={(event) => setNewColorName(event.target.value)}
              />
            </label>
            <label>
              Hex
              <input
                value={newColorHex}
                onChange={(event) => setNewColorHex(event.target.value)}
              />
            </label>
            <button onClick={handleAddColor}>Add Color</button>
          </div>
        </section>

        <section>
          <h2>Editor</h2>
          <label>
            Active Name
            <input
              value={project.name}
              onChange={(event) =>
                handleRenameActiveProject(event.target.value)
              }
            />
          </label>

          <div className="tool-row three-tools">
            <button
              className={model.toolMode === "paint" ? "selected" : ""}
              onClick={() =>
                setModel((current) => ({ ...current, toolMode: "paint" }))
              }
            >
              Paint
            </button>
            <button
              className={model.toolMode === "erase" ? "selected" : ""}
              onClick={() =>
                setModel((current) => ({ ...current, toolMode: "erase" }))
              }
            >
              Erase
            </button>
            <button
              className={model.toolMode === "select" ? "selected" : ""}
              onClick={() =>
                setModel((current) => ({ ...current, toolMode: "select" }))
              }
            >
              Select
            </button>
          </div>

          <label>
            Part Type
            <select
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

          <label>
            Zoom ({cellSize}px)
            <input
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

          <div className="tool-row">
            <button
              disabled={model.history.past.length === 0}
              onClick={handleUndo}
            >
              Undo
            </button>
            <button
              disabled={model.history.future.length === 0}
              onClick={handleRedo}
            >
              Redo
            </button>
          </div>
        </section>

        <section>
          <h2>Exports</h2>
          <div className="stacked-form">
            <button onClick={handleExportPng}>Export PNG</button>
            <button onClick={handleExportBomCsv}>Export BOM (CSV)</button>
            <button onClick={handleExportInstructionsJson}>
              Export Instructions (JSON)
            </button>
            <button onClick={handleExportInstructionsHtml}>
              Export Instructions (HTML)
            </button>
            <button onClick={handleExportProjectTxt}>
              Export Project (TXT)
            </button>
            <button onClick={handleImportFilePick}>Import Project (TXT)</button>
            <input
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
        className="editor-main"
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <div className="stats-strip">
          <strong>{project.name}</strong>
          <span>
            {project.width}x{project.height} studs
          </span>
          <span>{occupiedStuds} placed</span>
          {model.toolMode === "select" ? (
            <span>Drag to select; use arrow keys or drag inside the box to move.</span>
          ) : null}
          <span>{(coverage * 100).toFixed(1)}% coverage</span>
          {selectedColor ? (
            <span className="selected-color-preview">
              <i style={{ backgroundColor: selectedColor.hex }} />
              {selectedColor.name}
            </span>
          ) : null}
        </div>

        <div className="board-wrapper">
          <div className="board-with-axes">
            <div className="board-corner" />
            <div
              className="board-top-axis"
              style={{
                gridTemplateColumns: `repeat(${project.width}, ${cellSize}px)`,
              }}
            >
              {columnIndices.map((column) => (
                <span key={`col-${column}`} className="axis-label">
                  {shouldShowAxisMarker(column) ? column : ""}
                </span>
              ))}
            </div>
            <div
              className="board-left-axis"
              style={{
                gridTemplateRows: `repeat(${project.height}, ${cellSize}px)`,
              }}
            >
              {rowIndices.map((row) => (
                <span key={`row-${row}`} className="axis-label">
                  {shouldShowAxisMarker(row) ? row : ""}
                </span>
              ))}
            </div>
            <div
              className="board-grid"
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
                const bounds = selection ? getSelectionBounds(selection) : null;
                const isSelected =
                  bounds !== null &&
                  x >= bounds.left &&
                  x <= bounds.right &&
                  y >= bounds.top &&
                  y <= bounds.bottom;
                const selectionEdges =
                  isSelected && bounds
                    ? [
                        y === bounds.top && "selection-top",
                        x === bounds.right && "selection-right",
                        y === bounds.bottom && "selection-bottom",
                        x === bounds.left && "selection-left",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : "";

                return (
                  <button
                    key={`${x}-${y}`}
                    className={`stud-cell${isSelected ? ` in-selection ${selectionEdges}${model.toolMode === "select" ? " movable" : ""}` : ""}`}
                    style={
                      placement
                        ? { backgroundColor: color?.hex ?? "#111827" }
                        : undefined
                    }
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.currentTarget.focus({ preventScroll: true });
                      startDrag(x, y);
                    }}
                    onPointerEnter={() => continueDrag(x, y)}
                    title={`(${x + 1}, ${y + 1})`}
                  >
                    {placement ? (
                      <span
                        className={
                          placement.partType === "tile_1x1_round"
                            ? "stud-part round"
                            : placement.partType === "tile_1x1_square"
                              ? "stud-part square"
                              : "stud-part plate"
                        }
                        style={{ backgroundColor: color?.hex ?? "#111827" }}
                      />
                    ) : (
                      <span className="stud-empty" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      <aside className="panel right-panel">
        <section>
          <h2>Bill of Materials</h2>
          <div className="table-like">
            <div className="table-row table-head">
              <span>Part</span>
              <span>Color</span>
              <span>Count</span>
            </div>
            {bom.map((item) => (
              <div
                className="table-row"
                key={`${item.partType}-${item.colorId}`}
              >
                <span>{partTypeToDisplayName(item.partType)}</span>
                <span className="bom-color">
                  <i style={{ backgroundColor: item.colorHex }} />
                  {item.colorId}
                </span>
                <span>{item.count}</span>
              </div>
            ))}
            {bom.length === 0 ? (
              <p className="subtle">No parts placed yet.</p>
            ) : null}
          </div>
        </section>

        <section>
          <h2>Instructions</h2>
          <p className="subtle">Row-by-row build steps.</p>
          <div className="instruction-list">
            {instructions.slice(0, 100).map((step) => (
              <article key={step.stepNumber} className="instruction-step">
                <h3>
                  Step {step.stepNumber}: {step.title}
                </h3>
                <p>{step.cells.length} parts</p>
              </article>
            ))}
            {instructions.length > 100 ? (
              <p className="subtle">
                Showing first 100 steps. Export JSON/HTML for full instructions.
              </p>
            ) : null}
            {instructions.length === 0 ? (
              <p className="subtle">No instructions generated yet.</p>
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

function moveSelection(history: HistoryState, selection: GridSelection, dx: number, dy: number) {
  const bounds = getSelectionBounds(selection);
  dx = Math.max(-bounds.left, Math.min(dx, history.project.width - 1 - bounds.right));
  dy = Math.max(-bounds.top, Math.min(dy, history.project.height - 1 - bounds.bottom));
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
    history: applyUpdatesToHistory(history, [...updates.values()], "Move Selection"),
    selection: {
      anchor: { x: selection.anchor.x + dx, y: selection.anchor.y + dy },
      focus: { x: selection.focus.x + dx, y: selection.focus.y + dy },
    },
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
