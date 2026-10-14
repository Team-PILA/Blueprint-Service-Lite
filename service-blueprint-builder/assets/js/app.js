import { renderBlueprint, renderLoadError } from "./renderer.js";
import {
  createPrintFilename,
  printWithTemporaryTitle,
  renderPrintPreview,
  validateBlueprintForPrint,
} from "./print-renderer.js";

const DATA_URL = "data/blueprint.json";
const STORAGE_KEY = "service-blueprint-builder:data:v1";
const SAVE_DELAY = 450;
const LAYER_KEYS = [
  "physicalEvidence",
  "customerActions",
  "frontstageInteractions",
  "backstageActions",
  "supportProcesses",
  "systemsTools",
];

const elements = {
  editor: document.querySelector("#editor-view"),
  root: document.querySelector("#blueprint-root"),
  scroll: document.querySelector("#blueprint-scroll"),
  phaseCount: document.querySelector("#phase-count"),
  metadataService: document.querySelector("#metadata-service"),
  metadataOwner: document.querySelector("#metadata-owner"),
  metadataDate: document.querySelector("#metadata-date"),
  metadataStage: document.querySelector("#metadata-stage"),
  metadataDescription: document.querySelector("#metadata-description"),
  previewButton: document.querySelector("#preview-blueprint"),
  preview: document.querySelector("#print-preview"),
  previewSummary: document.querySelector("#print-preview-summary"),
  printPages: document.querySelector("#print-pages"),
  backToEditor: document.querySelector("#back-to-editor"),
  printButton: document.querySelector("#print-blueprint"),
  add: document.querySelector("#add-phase"),
  save: document.querySelector("#save-blueprint"),
  export: document.querySelector("#export-blueprint"),
  import: document.querySelector("#import-blueprint"),
  file: document.querySelector("#blueprint-file"),
  restore: document.querySelector("#restore-blueprint"),
  status: document.querySelector("#session-status"),
  statusText: document.querySelector("#session-status-text"),
};

let blueprint = null;
let templateBlueprint = null;
let saveTimer = null;
let previewReturnFocus = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reindexPhases(phases = blueprint.phases) {
  phases.forEach((phase, index) => {
    phase.id = `F${index + 1}`;
  });
}

function normalizeBlueprint(candidate) {
  if (!candidate || !Array.isArray(candidate.phases) || candidate.phases.length === 0) {
    throw new TypeError("El blueprint debe contener al menos una fase.");
  }

  const phases = candidate.phases.map((phase) => {
    const layers = {};
    LAYER_KEYS.forEach((key) => {
      const value = phase.layers?.[key];
      if (Array.isArray(value)) {
        layers[key] = value.map((item) => String(item));
      } else if (typeof value === "string") {
        layers[key] = value.split(/\r?\n/);
      } else {
        layers[key] = [];
      }
    });

    return {
      id: "",
      name: typeof phase.name === "string" ? phase.name : "",
      description: typeof phase.description === "string" ? phase.description : "",
      layers,
    };
  });

  reindexPhases(phases);

  return {
    metadata: {
      service: typeof candidate.metadata?.service === "string" ? candidate.metadata.service : "",
      owner: typeof candidate.metadata?.owner === "string" ? candidate.metadata.owner : "",
      date: typeof candidate.metadata?.date === "string" ? candidate.metadata.date : "",
      stage: typeof candidate.metadata?.stage === "string" ? candidate.metadata.stage : "To-Be",
      description:
        typeof candidate.metadata?.description === "string" ? candidate.metadata.description : "",
    },
    phases,
  };
}

function validateImportedBlueprint(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("El archivo debe contener un objeto JSON de blueprint.");
  }

  if (
    !Object.hasOwn(candidate, "metadata") ||
    !candidate.metadata ||
    typeof candidate.metadata !== "object" ||
    Array.isArray(candidate.metadata)
  ) {
    throw new TypeError('Falta el objeto obligatorio "metadata".');
  }

  if (!Object.hasOwn(candidate, "phases") || !Array.isArray(candidate.phases)) {
    throw new TypeError('Falta el arreglo obligatorio "phases".');
  }

  if (candidate.phases.length === 0) {
    throw new TypeError("El blueprint debe contener al menos una fase.");
  }

  candidate.phases.forEach((phase, index) => {
    const phaseLabel = `La fase en la posición ${index + 1}`;
    if (!phase || typeof phase !== "object" || Array.isArray(phase)) {
      throw new TypeError(`${phaseLabel} no es un objeto válido.`);
    }

    if (!phase.layers || typeof phase.layers !== "object" || Array.isArray(phase.layers)) {
      throw new TypeError(`${phaseLabel} no contiene el objeto obligatorio "layers".`);
    }

    LAYER_KEYS.forEach((key) => {
      if (!Object.hasOwn(phase.layers, key)) {
        throw new TypeError(`${phaseLabel} no contiene la capa obligatoria "${key}".`);
      }
      if (!Array.isArray(phase.layers[key])) {
        throw new TypeError(`${phaseLabel}: la capa "${key}" debe ser un arreglo.`);
      }
    });
  });

  return normalizeBlueprint(candidate);
}

async function loadTemplate() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo cargar ${DATA_URL}: HTTP ${response.status}`);
  return normalizeBlueprint(await response.json());
}

function loadStoredBlueprint() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  try {
    return normalizeBlueprint(JSON.parse(stored));
  } catch (error) {
    console.warn("Se descartó una copia local inválida.", error);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function setStatus(state, text) {
  elements.status.dataset.state = state;
  elements.statusText.textContent = text;
}

function updatePhaseCount() {
  const count = blueprint.phases.length;
  elements.phaseCount.textContent = `${count} ${count === 1 ? "fase" : "fases"}`;
}

function resizeMetadataDescription() {
  const editor = elements.metadataDescription;
  editor.style.height = "auto";
  editor.style.height = `${Math.max(editor.scrollHeight, 42)}px`;
}

function renderMetadata() {
  elements.metadataService.value = blueprint.metadata.service;
  elements.metadataOwner.value = blueprint.metadata.owner;
  elements.metadataDate.value = /^\d{4}-\d{2}-\d{2}$/.test(blueprint.metadata.date)
    ? blueprint.metadata.date
    : "";
  elements.metadataStage.value = blueprint.metadata.stage;
  elements.metadataDescription.value = blueprint.metadata.description;
  requestAnimationFrame(resizeMetadataDescription);
}

function updateMetadata(key, value) {
  blueprint.metadata[key] = value;
  scheduleSave();
}

function setControlsEnabled(enabled) {
  elements.previewButton.disabled = !enabled;
  elements.add.disabled = !enabled;
  elements.save.disabled = !enabled;
  elements.export.disabled = !enabled;
  elements.import.disabled = !enabled;
  elements.restore.disabled = !enabled;
}

function persistBlueprint(message = "Cambios guardados en este navegador") {
  if (!blueprint) return false;

  window.clearTimeout(saveTimer);
  saveTimer = null;

  try {
    reindexPhases();
    const validated = normalizeBlueprint(blueprint);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
    setStatus("saved", message);
    return true;
  } catch (error) {
    console.error(error);
    setStatus("error", "No se pudieron guardar los cambios");
    return false;
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  setStatus("saving", "Cambios pendientes · guardando…");
  saveTimer = window.setTimeout(() => persistBlueprint(), SAVE_DELAY);
}

function render() {
  renderMetadata();
  renderBlueprint(elements.root, blueprint, {
    onChange: scheduleSave,
    onMove: movePhase,
    onDelete: deletePhase,
  });
  updatePhaseCount();
}

function createPhase() {
  return {
    id: `F${blueprint.phases.length + 1}`,
    name: "",
    description: "",
    layers: Object.fromEntries(LAYER_KEYS.map((key) => [key, []])),
  };
}

function addPhase() {
  blueprint.phases.push(createPhase());
  reindexPhases();
  render();
  scheduleSave();

  requestAnimationFrame(() => {
    elements.scroll.scrollTo({ left: elements.scroll.scrollWidth, behavior: "smooth" });
    const newIndex = blueprint.phases.length - 1;
    elements.root
      .querySelector(`[data-phase-index="${newIndex}"] [data-role="phase-name"]`)
      ?.focus({ preventScroll: true });
  });
}

function movePhase(index, direction) {
  const destination = index + direction;
  if (destination < 0 || destination >= blueprint.phases.length) return;

  const [phase] = blueprint.phases.splice(index, 1);
  blueprint.phases.splice(destination, 0, phase);
  reindexPhases();
  render();
  scheduleSave();
}

function deletePhase(index) {
  if (blueprint.phases.length === 1) {
    setStatus("error", "Debe existir al menos una fase");
    return;
  }

  const phase = blueprint.phases[index];
  const label = phase.name.trim() ? `${phase.id} · ${phase.name.trim()}` : phase.id;
  const confirmed = window.confirm(
    `¿Eliminar la fase ${label}? También se eliminarán todos sus datos asociados.`,
  );
  if (!confirmed) return;

  blueprint.phases.splice(index, 1);
  reindexPhases();
  render();
  scheduleSave();
}

function restoreTemplate() {
  const confirmed = window.confirm(
    "¿Restaurar la plantilla original? Se eliminarán los cambios guardados en este navegador.",
  );
  if (!confirmed) return;

  window.clearTimeout(saveTimer);
  saveTimer = null;
  localStorage.removeItem(STORAGE_KEY);
  blueprint = clone(templateBlueprint);
  render();
  setStatus("saved", "Plantilla original restaurada");
  elements.scroll.scrollTo({ left: 0, behavior: "smooth" });
}

function exportBlueprint() {
  try {
    reindexPhases();
    const exportData = normalizeBlueprint(blueprint);
    const contents = `${JSON.stringify(exportData, null, 2)}\n`;
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "blueprint.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus("saved", "Blueprint exportado como blueprint.json");
  } catch (error) {
    console.error(error);
    setStatus("error", "No se pudo exportar el blueprint");
    window.alert(`No se pudo exportar el blueprint.\n\n${error.message}`);
  }
}

async function importBlueprint(file) {
  if (!file) return;

  try {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new SyntaxError("El archivo no contiene JSON válido.");
    }

    const importedBlueprint = validateImportedBlueprint(parsed);
    const confirmed = window.confirm(
      `¿Importar "${file.name}"? El blueprint actual será reemplazado por el contenido del archivo.`,
    );

    if (!confirmed) {
      setStatus("saved", "Importación cancelada; no se realizaron cambios");
      return;
    }

    blueprint = importedBlueprint;
    render();
    persistBlueprint("Blueprint importado y guardado en este navegador");
    elements.scroll.scrollTo({ left: 0, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    setStatus("error", "El archivo no pudo importarse");
    window.alert(`No se pudo importar el blueprint.\n\n${error.message}`);
  }
}

function validationMessage(title, items) {
  return `${title}\n\n${items.map((item) => `• ${item}`).join("\n")}`;
}

function openPrintPreview() {
  const { errors, warnings } = validateBlueprintForPrint(blueprint);

  if (errors.length > 0) {
    setStatus("error", "El blueprint requiere información antes de imprimir");
    window.alert(
      validationMessage("No se puede abrir la vista previa. Corrige estos errores:", errors),
    );
    return;
  }

  if (
    warnings.length > 0 &&
    !window.confirm(
      `${validationMessage("El blueprint puede imprimirse, pero contiene advertencias:", warnings)}\n\n¿Deseas continuar?`,
    )
  ) {
    setStatus("saved", "Vista previa cancelada; no se realizaron cambios");
    return;
  }

  previewReturnFocus = document.activeElement;
  const snapshot = clone(blueprint);
  const model = renderPrintPreview(elements.printPages, snapshot);
  elements.previewSummary.textContent = `${model.phaseCount} ${model.phaseCount === 1 ? "fase" : "fases"} · ${model.pageCount} ${model.pageCount === 1 ? "página" : "páginas"}`;
  elements.editor.hidden = true;
  elements.preview.hidden = false;
  document.body.classList.add("is-print-preview");
  window.scrollTo({ top: 0, behavior: "auto" });
  elements.backToEditor.focus();
}

function closePrintPreview() {
  elements.preview.hidden = true;
  elements.editor.hidden = false;
  elements.printPages.replaceChildren();
  document.body.classList.remove("is-print-preview");
  window.scrollTo({ top: 0, behavior: "auto" });

  if (previewReturnFocus instanceof HTMLElement) previewReturnFocus.focus();
  previewReturnFocus = null;
}

function printBlueprint() {
  const title = createPrintFilename(blueprint.metadata.service);
  printWithTemporaryTitle(window, document, title);
}

async function initialize() {
  try {
    templateBlueprint = await loadTemplate();
    const storedBlueprint = loadStoredBlueprint();
    blueprint = storedBlueprint ?? clone(templateBlueprint);
    render();
    setControlsEnabled(true);
    setStatus(
      "saved",
      storedBlueprint ? "Últimos cambios recuperados" : "Plantilla original cargada",
    );
  } catch (error) {
    elements.phaseCount.textContent = "Error de carga";
    setStatus("error", "No se pudo iniciar la aplicación");
    renderLoadError(elements.root, error);
  }
}

elements.add.addEventListener("click", addPhase);
elements.save.addEventListener("click", () => persistBlueprint("Guardado manual completado"));
elements.previewButton.addEventListener("click", openPrintPreview);
elements.backToEditor.addEventListener("click", closePrintPreview);
elements.printButton.addEventListener("click", printBlueprint);
elements.export.addEventListener("click", exportBlueprint);
elements.import.addEventListener("click", () => {
  elements.file.value = "";
  elements.file.click();
});
elements.file.addEventListener("change", () => importBlueprint(elements.file.files?.[0]));
elements.restore.addEventListener("click", restoreTemplate);
elements.metadataService.addEventListener("input", (event) =>
  updateMetadata("service", event.currentTarget.value),
);
elements.metadataOwner.addEventListener("input", (event) =>
  updateMetadata("owner", event.currentTarget.value),
);
elements.metadataDate.addEventListener("input", (event) =>
  updateMetadata("date", event.currentTarget.value),
);
elements.metadataStage.addEventListener("input", (event) =>
  updateMetadata("stage", event.currentTarget.value),
);
elements.metadataDescription.addEventListener("input", (event) => {
  updateMetadata("description", event.currentTarget.value);
  resizeMetadataDescription();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.preview.hidden) closePrintPreview();
});
window.addEventListener("beforeunload", () => {
  if (saveTimer) persistBlueprint();
});

initialize();
