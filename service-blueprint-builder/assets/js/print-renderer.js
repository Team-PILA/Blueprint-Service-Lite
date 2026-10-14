export const PHASES_PER_PRINT_PAGE = 4;

export const PRINT_LAYERS = [
  { key: "physicalEvidence", label: "Physical Evidence" },
  { key: "customerActions", label: "Customer Actions" },
  { key: "frontstageInteractions", label: "Frontstage Interactions" },
  { key: "backstageActions", label: "Backstage Actions" },
  { key: "supportProcesses", label: "Support Processes" },
  { key: "systemsTools", label: "Systems / Tools", className: "print-systems-row" },
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function layerHasContent(value) {
  return Array.isArray(value) && value.some((item) => String(item).trim().length > 0);
}

function formatDate(value) {
  if (!hasText(value)) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function textOrDash(value) {
  return hasText(value) ? value.trim() : "—";
}

function cellText(value) {
  if (!Array.isArray(value)) return "";
  return value.map((item) => String(item)).join("\n");
}

export function paginatePhases(phases, pageSize = PHASES_PER_PRINT_PAGE) {
  if (!Array.isArray(phases)) throw new TypeError("Las fases deben ser un arreglo.");
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError("La cantidad de fases por página debe ser un entero positivo.");
  }

  const pages = [];
  for (let index = 0; index < phases.length; index += pageSize) {
    pages.push(phases.slice(index, index + pageSize));
  }
  return pages;
}

export function createPrintModel(source, pageSize = PHASES_PER_PRINT_PAGE) {
  const snapshot = deepClone(source);
  snapshot.phases.forEach((phase, index) => {
    phase.id = `F${index + 1}`;
  });

  const groups = paginatePhases(snapshot.phases, pageSize);
  return {
    metadata: snapshot.metadata,
    phaseCount: snapshot.phases.length,
    pageCount: groups.length,
    pages: groups.map((phases, index) => ({
      number: index + 1,
      phases,
      firstPhaseId: phases[0].id,
      lastPhaseId: phases[phases.length - 1].id,
    })),
  };
}

export function validateBlueprintForPrint(candidate) {
  const errors = [];
  const warnings = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { errors: ["El estado interno del blueprint no es válido."], warnings };
  }

  const metadata = candidate.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    errors.push("El estado interno no contiene metadata válida.");
  } else {
    if (!hasText(metadata.service)) errors.push("El nombre del servicio es obligatorio.");
    if (!hasText(metadata.description)) warnings.push("La descripción del servicio está vacía.");
    if (!hasText(metadata.owner)) warnings.push("El responsable está vacío.");
    if (!hasText(metadata.date)) warnings.push("La fecha está vacía.");
    if (!hasText(metadata.stage)) warnings.push("La etapa está vacía.");
  }

  if (!Array.isArray(candidate.phases) || candidate.phases.length === 0) {
    errors.push("Debe existir al menos una fase.");
    return { errors, warnings };
  }

  const ids = new Set();
  let emptyLayerCells = 0;

  candidate.phases.forEach((phase, index) => {
    const position = index + 1;
    const expectedId = `F${position}`;

    if (!phase || typeof phase !== "object" || Array.isArray(phase)) {
      errors.push(`La fase en la posición ${position} no es válida.`);
      return;
    }

    if (phase.id !== expectedId) {
      errors.push(`La fase en la posición ${position} debe tener el identificador ${expectedId}.`);
    }
    if (ids.has(phase.id)) errors.push(`El identificador ${phase.id || "vacío"} está duplicado.`);
    ids.add(phase.id);

    if (!hasText(phase.name)) errors.push(`${expectedId} debe tener un nombre.`);

    if (!phase.layers || typeof phase.layers !== "object" || Array.isArray(phase.layers)) {
      errors.push(`${expectedId} no contiene una estructura de capas válida.`);
      return;
    }

    PRINT_LAYERS.forEach(({ key, label }) => {
      if (!Object.hasOwn(phase.layers, key) || !Array.isArray(phase.layers[key])) {
        errors.push(`${expectedId} no contiene correctamente la capa ${label}.`);
      } else if (!layerHasContent(phase.layers[key])) {
        emptyLayerCells += 1;
      }
    });
  });

  if (emptyLayerCells > 0) {
    warnings.push(
      `${emptyLayerCells} ${emptyLayerCells === 1 ? "celda de capa está vacía" : "celdas de capas están vacías"}.`,
    );
  }

  return { errors, warnings };
}

export function createPrintFilename(serviceName) {
  const normalized = String(serviceName || "Servicio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");

  return `Service_Blueprint_ToBe_${normalized || "Servicio"}`;
}

export function printWithTemporaryTitle(browserWindow, browserDocument, title) {
  const originalTitle = browserDocument.title;
  browserDocument.title = title;

  try {
    browserWindow.print();
  } finally {
    browserDocument.title = originalTitle;
  }
}

function appendMetaItem(container, label, value) {
  const item = document.createElement("div");
  item.className = "print-meta__item";

  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = textOrDash(value);

  item.append(term, description);
  container.append(item);
}

function createDocumentHeader(model, page) {
  const header = document.createElement("header");
  header.className = "print-document-header";

  const titleArea = document.createElement("div");
  titleArea.className = "print-document-header__title";
  const eyebrow = document.createElement("p");
  eyebrow.textContent = `Página ${page.number} de ${model.pageCount}`;
  const title = document.createElement("h1");
  title.textContent = "Blueprint Service To-Be";
  const service = document.createElement("p");
  service.className = "print-service-name";
  service.textContent = textOrDash(model.metadata.service);
  titleArea.append(eyebrow, title, service);

  const summary = document.createElement("dl");
  summary.className = "print-meta";
  appendMetaItem(summary, "Responsable", model.metadata.owner);
  appendMetaItem(summary, "Fecha", formatDate(model.metadata.date));
  appendMetaItem(summary, "Etapa", model.metadata.stage);
  appendMetaItem(summary, "Fases", `${page.firstPhaseId} a ${page.lastPhaseId}`);
  appendMetaItem(summary, "Total", `${model.phaseCount} fases`);

  header.append(titleArea, summary);

  if (hasText(model.metadata.description)) {
    const description = document.createElement("p");
    description.className = "print-service-description";
    description.textContent = model.metadata.description.trim();
    header.append(description);
  }

  return header;
}

function createPhaseHeaderRow(phases) {
  const row = document.createElement("tr");
  const label = document.createElement("th");
  label.className = "print-layer-label print-phase-label";
  label.scope = "row";
  label.textContent = "Phase";
  row.append(label);

  phases.forEach((phase) => {
    const cell = document.createElement("th");
    cell.className = "print-phase-cell";
    cell.scope = "col";

    const id = document.createElement("span");
    id.className = "print-phase-id";
    id.textContent = phase.id;
    const name = document.createElement("strong");
    name.className = "print-phase-name";
    name.textContent = phase.name;
    cell.append(id, name);

    if (hasText(phase.description)) {
      const description = document.createElement("span");
      description.className = "print-phase-description";
      description.textContent = phase.description;
      cell.append(description);
    }

    row.append(cell);
  });

  return row;
}

function createLayerRow(layer, phases) {
  const row = document.createElement("tr");
  if (layer.className) row.className = layer.className;

  const label = document.createElement("th");
  label.className = "print-layer-label";
  label.scope = "row";
  label.textContent = layer.label;
  row.append(label);

  phases.forEach((phase) => {
    const cell = document.createElement("td");
    cell.textContent = cellText(phase.layers[layer.key]);
    row.append(cell);
  });

  return row;
}

function createPrintTable(phases) {
  const table = document.createElement("table");
  table.className = "print-blueprint-table";
  table.setAttribute("aria-label", "Página del Blueprint Service");

  const columns = document.createElement("colgroup");
  const labelColumn = document.createElement("col");
  labelColumn.className = "print-label-column";
  columns.append(labelColumn);
  phases.forEach(() => {
    const phaseColumn = document.createElement("col");
    phaseColumn.className = "print-phase-column";
    phaseColumn.style.width = `${82 / phases.length}%`;
    columns.append(phaseColumn);
  });

  const head = document.createElement("thead");
  head.append(createPhaseHeaderRow(phases));
  const body = document.createElement("tbody");
  PRINT_LAYERS.forEach((layer) => body.append(createLayerRow(layer, phases)));

  table.append(columns, head, body);
  return table;
}

export function renderPrintPreview(root, source, pageSize = PHASES_PER_PRINT_PAGE) {
  const model = createPrintModel(source, pageSize);
  const fragment = document.createDocumentFragment();

  model.pages.forEach((page) => {
    const pageElement = document.createElement("article");
    pageElement.className = "print-page";
    pageElement.dataset.pageNumber = String(page.number);
    pageElement.append(createDocumentHeader(model, page), createPrintTable(page.phases));
    fragment.append(pageElement);
  });

  root.replaceChildren(fragment);
  return model;
}
