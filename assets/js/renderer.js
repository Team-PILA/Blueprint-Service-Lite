const LAYERS = [
  { key: "physicalEvidence", label: "Physical Evidence" },
  { key: "customerActions", label: "Customer Actions" },
  { key: "frontstageInteractions", label: "Frontstage Interactions" },
  { key: "backstageActions", label: "Backstage Actions" },
  { key: "supportProcesses", label: "Support Processes" },
  { key: "systemsTools", label: "Systems / Tools", className: "systems-row" },
];

function createEditor({ value = "", label, placeholder = "Escribe aquí…", className = "" }) {
  const editor = document.createElement("textarea");
  editor.className = `cell-editor ${className}`.trim();
  editor.value = value;
  editor.placeholder = placeholder;
  editor.setAttribute("aria-label", label);
  editor.setAttribute("spellcheck", "true");

  const resize = () => {
    const minimum = editor.classList.contains("phase-editor")
      ? 40
      : editor.classList.contains("phase-description-editor")
        ? 36
        : 142;
    editor.style.height = "auto";
    editor.style.height = `${Math.max(editor.scrollHeight, minimum)}px`;
  };

  editor.addEventListener("input", resize);
  requestAnimationFrame(resize);

  return editor;
}

function createActionButton({ label, symbol, className = "", disabled = false, onClick }) {
  const button = document.createElement("button");
  button.className = `phase-action ${className}`.trim();
  button.type = "button";
  button.textContent = symbol;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function normalizeCellValue(value) {
  if (Array.isArray(value)) return value.join("\n");
  return typeof value === "string" ? value : "";
}

function createPhaseRow(phases, actions) {
  const row = document.createElement("tr");
  row.className = "phase-row";

  const labelCell = document.createElement("th");
  labelCell.className = "layer-label";
  labelCell.scope = "row";
  labelCell.textContent = "Phase";
  row.append(labelCell);

  phases.forEach((phase, phaseIndex) => {
    const cell = document.createElement("th");
    cell.className = "phase-cell";
    cell.scope = "col";
    cell.dataset.phaseIndex = String(phaseIndex);

    const topLine = document.createElement("div");
    topLine.className = "phase-cell__topline";

    const id = document.createElement("span");
    id.className = "phase-id";
    id.textContent = phase.id;

    const controls = document.createElement("div");
    controls.className = "phase-actions";
    controls.append(
      createActionButton({
        label: `Mover fase ${phase.id} a la izquierda`,
        symbol: "←",
        disabled: phaseIndex === 0,
        onClick: () => actions.onMove(phaseIndex, -1),
      }),
      createActionButton({
        label: `Mover fase ${phase.id} a la derecha`,
        symbol: "→",
        disabled: phaseIndex === phases.length - 1,
        onClick: () => actions.onMove(phaseIndex, 1),
      }),
      createActionButton({
        label: `Eliminar fase ${phase.id}`,
        symbol: "×",
        className: "phase-action--delete",
        disabled: phases.length === 1,
        onClick: () => actions.onDelete(phaseIndex),
      }),
    );

    topLine.append(id, controls);

    const nameEditor = createEditor({
      value: phase.name,
      label: `Nombre de la fase ${phase.id}`,
      placeholder: "Nombre de la fase…",
      className: "phase-editor",
    });
    nameEditor.dataset.role = "phase-name";
    nameEditor.addEventListener("input", () => {
      phase.name = nameEditor.value;
      actions.onChange();
    });

    const descriptionEditor = createEditor({
      value: phase.description,
      label: `Descripción breve de la fase ${phase.id}`,
      placeholder: "Descripción breve…",
      className: "phase-description-editor",
    });
    descriptionEditor.addEventListener("input", () => {
      phase.description = descriptionEditor.value;
      actions.onChange();
    });

    cell.append(topLine, nameEditor, descriptionEditor);
    row.append(cell);
  });

  return row;
}

function createLayerRow(layer, phases, actions) {
  const row = document.createElement("tr");
  if (layer.className) row.className = layer.className;

  const labelCell = document.createElement("th");
  labelCell.className = "layer-label";
  labelCell.scope = "row";
  labelCell.textContent = layer.label;
  row.append(labelCell);

  phases.forEach((phase) => {
    const cell = document.createElement("td");
    cell.className = "blueprint-cell";

    const editor = createEditor({
      value: normalizeCellValue(phase.layers[layer.key]),
      label: `${layer.label}, ${phase.id}`,
    });
    editor.addEventListener("input", () => {
      phase.layers[layer.key] = editor.value.split(/\r?\n/);
      actions.onChange();
    });

    cell.append(editor);
    row.append(cell);
  });

  return row;
}

function createColumnGroup(phaseCount) {
  const group = document.createElement("colgroup");
  group.append(document.createElement("col"));
  for (let index = 0; index < phaseCount; index += 1) group.append(document.createElement("col"));
  return group;
}

export function renderBlueprint(root, blueprint, actions) {
  const phases = blueprint.phases;
  root.replaceChildren();

  const table = document.createElement("table");
  table.className = "blueprint-table";
  table.setAttribute("aria-label", "Blueprint Service editable");
  table.append(createColumnGroup(phases.length));

  const body = document.createElement("tbody");
  body.append(createPhaseRow(phases, actions));
  LAYERS.forEach((layer) => body.append(createLayerRow(layer, phases, actions)));

  table.append(body);
  root.append(table);
}

export function renderLoadError(root, error) {
  const message = document.createElement("div");
  message.className = "error-state";
  message.setAttribute("role", "alert");

  const title = document.createElement("strong");
  title.textContent = "No se pudo cargar el blueprint.";

  const detail = document.createElement("span");
  detail.textContent =
    "Abre el proyecto mediante un servidor local para permitir la lectura del archivo JSON.";

  const command = document.createElement("code");
  command.textContent = "npx serve .";

  message.append(title, detail, command);
  root.replaceChildren(message);
  console.error(error);
}
