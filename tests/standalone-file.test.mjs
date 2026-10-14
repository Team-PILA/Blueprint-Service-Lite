import assert from "node:assert/strict";

const debugPort = Number(process.argv[2] || 9333);
const endpoint = `http://127.0.0.1:${debugPort}`;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getPageTarget() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch(`${endpoint}/json`).then((response) => response.json());
      const target = targets.find((item) => item.type === "page");
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error("No se encontró una página de Chrome.");
}

const target = await getPageTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const consoleErrors = [];
const exceptions = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }

  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    consoleErrors.push(message.params.entry.text);
  }
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

function makeBlueprint(phaseCount, { multiline = false } = {}) {
  const layerKeys = [
    "physicalEvidence",
    "customerActions",
    "frontstageInteractions",
    "backstageActions",
    "supportProcesses",
    "systemsTools",
  ];
  return {
    metadata: {
      service: `Servicio autónomo ${phaseCount}`,
      owner: "Equipo QA",
      date: "2026-10-14",
      stage: "To-Be",
      description: "Prueba ejecutada directamente mediante file://",
    },
    phases: Array.from({ length: phaseCount }, (_, index) => ({
      id: `IGNORED-${index}`,
      name: `Fase compartida ${index + 1}`,
      description: `Descripción ${index + 1}`,
      layers: Object.fromEntries(
        layerKeys.map((key) => [
          key,
          multiline && index === 0
            ? Array.from({ length: 3 }, (_, line) => `${key} · línea ${line + 1}`)
            : [`Contenido ${key} ${index + 1}`],
        ]),
      ),
    })),
  };
}

async function importBlueprint(blueprint, filename = "shared-blueprint.json") {
  return evaluate(`(async () => {
    const input = document.querySelector("#blueprint-file");
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(blueprint))}], ${JSON.stringify(filename)}, {
      type: "application/json",
    }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      phaseCount: document.querySelectorAll(".phase-cell").length,
      ids: [...document.querySelectorAll(".phase-id")].map((node) => node.textContent),
      inputReset: input.value === "",
    };
  })()`);
}

async function openPreview() {
  return evaluate(`(() => {
    document.querySelector("#preview-blueprint").click();
    const pages = [...document.querySelectorAll("#print-pages .print-page")];
    return {
      editorHidden: document.querySelector("#editor-view").hidden,
      previewVisible: !document.querySelector("#print-preview").hidden,
      pageCount: pages.length,
      rows: pages.map((page) => page.querySelectorAll("tr").length),
      hasLayerColumn: pages.every((page) => page.querySelector(".print-layer-label")),
      editableControls: document.querySelectorAll("#print-pages input, #print-pages textarea, #print-pages button").length,
      ids: [...document.querySelectorAll("#print-pages .print-phase-id")].map((node) => node.textContent),
    };
  })()`);
}

async function closePreview() {
  return evaluate(`(() => {
    document.querySelector("#back-to-editor").click();
    return {
      editorVisible: !document.querySelector("#editor-view").hidden,
      previewHidden: document.querySelector("#print-preview").hidden,
      phaseCount: document.querySelectorAll(".phase-cell").length,
    };
  })()`);
}

async function physicalPdfPageCount() {
  const { data } = await send("Page.printToPDF", {
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
  });
  const pdf = Buffer.from(data, "base64").toString("latin1");
  return (pdf.match(/\/Type\s*\/Page\b/g) || []).length;
}

try {
  await Promise.all([send("Runtime.enable"), send("Page.enable"), send("Log.enable"), send("Network.enable")]);
  await delay(300);

  const initial = await evaluate(`({
    protocol: location.protocol,
    ready: document.readyState,
    table: Boolean(document.querySelector(".blueprint-table")),
    phases: document.querySelectorAll(".phase-cell").length,
    status: document.querySelector("#session-status-text").textContent,
    resources: performance.getEntriesByType("resource").map((entry) => entry.name),
    phasePosition: getComputedStyle(document.querySelector(".phase-cell")).position,
    labelPosition: getComputedStyle(document.querySelector(".layer-label")).position,
    labelLeft: getComputedStyle(document.querySelector(".layer-label")).left,
  })`);
  assert.equal(initial.protocol, "file:");
  assert.equal(initial.ready, "complete");
  assert.equal(initial.table, true);
  assert.equal(initial.phases, 1);
  assert.match(initial.status, /Archivo autónomo/);
  assert.deepEqual(initial.resources, []);
  assert.equal(initial.phasePosition, "static");
  assert.equal(initial.labelPosition, "sticky");
  assert.equal(initial.labelLeft, "0px");
  console.log("✓ apertura file://, plantilla, cero recursos de red y sticky horizontal");

  await evaluate(`(() => {
    window.confirm = () => true;
    window.alert = (message) => { window.__lastAlert = message; };
    const edit = (selector, value) => {
      const control = document.querySelector(selector);
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };
    edit("#metadata-service", "Servicio persistente");
    edit("#metadata-owner", "Responsable local");
    edit('[data-phase-index="0"] [data-role="phase-name"]', "Fase inicial");
    edit('textarea[aria-label="Customer Actions, F1"]', "Línea uno\\nLínea dos");
    document.querySelector("#add-phase").click();
    edit('[data-phase-index="1"] [data-role="phase-name"]', "Segunda fase");
    return true;
  })()`);
  await delay(650);

  let state = await evaluate(`({
    count: document.querySelectorAll(".phase-cell").length,
    ids: [...document.querySelectorAll(".phase-id")].map((node) => node.textContent),
    stored: Boolean(localStorage.getItem("serviceBlueprintBuilder.standalone.v1")),
    multiline: document.querySelector('textarea[aria-label="Customer Actions, F1"]').value,
  })`);
  assert.equal(state.count, 2);
  assert.deepEqual(state.ids, ["F1", "F2"]);
  assert.equal(state.stored, true);
  assert.equal(state.multiline, "Línea uno\nLínea dos");

  await evaluate(`document.querySelector('[aria-label="Mover fase F1 a la derecha"]').click()`);
  state = await evaluate(`({
    ids: [...document.querySelectorAll(".phase-id")].map((node) => node.textContent),
    names: [...document.querySelectorAll('[data-role="phase-name"]')].map((node) => node.value),
  })`);
  assert.deepEqual(state.ids, ["F1", "F2"]);
  assert.deepEqual(state.names, ["Segunda fase", "Fase inicial"]);
  console.log("✓ metadata, edición, multilínea, alta, movimiento, renumeración y autoguardado");

  await send("Page.reload", { ignoreCache: true });
  await delay(700);
  state = await evaluate(`({
    service: document.querySelector("#metadata-service").value,
    names: [...document.querySelectorAll('[data-role="phase-name"]')].map((node) => node.value),
  })`);
  assert.equal(state.service, "Servicio persistente");
  assert.deepEqual(state.names, ["Segunda fase", "Fase inicial"]);
  await evaluate(`(() => { window.confirm = () => true; window.alert = (message) => { window.__lastAlert = message; }; })()`);
  console.log("✓ recuperación tras recarga directa del archivo");

  await evaluate(`document.querySelector('[aria-label="Eliminar fase F2"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll(".phase-cell").length`), 1);
  assert.equal(await evaluate(`document.querySelector(".phase-id").textContent`), "F1");
  console.log("✓ eliminación confirmada y conservación de una fase");

  const exportResult = await evaluate(`(async () => {
    URL.createObjectURL = (blob) => { window.__exportBlob = blob; return "blob:standalone-test"; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { window.__downloadName = this.download; };
    document.querySelector("#export-blueprint").click();
    return {
      name: window.__downloadName,
      json: JSON.parse(await window.__exportBlob.text()),
    };
  })()`);
  assert.match(exportResult.name, /^Blueprint_ToBe_Servicio_persistente\.json$/);
  assert.equal(exportResult.json.metadata.service, "Servicio persistente");
  assert.equal(exportResult.json.phases.length, 1);
  const roundTrip = await importBlueprint(exportResult.json, exportResult.name);
  assert.equal(roundTrip.phaseCount, 1);
  assert.equal(
    await evaluate(`document.querySelector("#metadata-service").value`),
    "Servicio persistente",
  );
  console.log("✓ exportación JSON autónoma con nombre basado en el servicio");

  const validImport = await importBlueprint(makeBlueprint(5));
  assert.equal(validImport.phaseCount, 5);
  assert.deepEqual(validImport.ids, ["F1", "F2", "F3", "F4", "F5"]);
  assert.equal(validImport.inputReset, true);

  const beforeInvalid = await evaluate(`document.querySelectorAll(".phase-cell").length`);
  await evaluate(`(async () => {
    const input = document.querySelector("#blueprint-file");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["{ inválido"], "invalid.json", { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll(".phase-cell").length`), beforeInvalid);
  assert.match(await evaluate(`window.__lastAlert`), /JSON válido/);
  console.log("✓ importación válida, selector reiniciado e importación inválida no destructiva");

  for (const count of [1, 4, 5, 6, 10]) {
    const imported = await importBlueprint(makeBlueprint(count, { multiline: count === 6 }));
    assert.equal(imported.phaseCount, count);
    const preview = await openPreview();
    const expectedPages = Math.ceil(count / 4);
    assert.equal(preview.editorHidden, true);
    assert.equal(preview.previewVisible, true);
    assert.equal(preview.pageCount, expectedPages);
    assert.ok(preview.rows.every((rows) => rows === 7));
    assert.equal(preview.hasLayerColumn, true);
    assert.equal(preview.editableControls, 0);
    assert.deepEqual(
      preview.ids,
      Array.from({ length: count }, (_, index) => `F${index + 1}`),
    );
    assert.equal(await physicalPdfPageCount(), expectedPages);
    const returned = await closePreview();
    assert.equal(returned.editorVisible, true);
    assert.equal(returned.previewHidden, true);
    assert.equal(returned.phaseCount, count);
  }
  console.log("✓ vista previa y PDF físicos con 1, 4, 5, 6 y 10 fases; sin páginas extra");

  await importBlueprint(makeBlueprint(4));
  await openPreview();
  const printResult = await evaluate(`(() => {
    const before = document.title;
    window.print = () => { window.__printCalled = true; };
    document.querySelector("#print-blueprint").click();
    return {
      called: window.__printCalled,
      titleRestored: document.title === before,
      previewVisible: !document.querySelector("#print-preview").hidden,
    };
  })()`);
  assert.deepEqual(printResult, { called: true, titleRestored: true, previewVisible: true });
  await closePreview();
  console.log("✓ cancelación simulada de impresión, título restaurado y regreso al editor");

  await evaluate(`document.querySelector("#restore-blueprint").click()`);
  const restored = await evaluate(`({
    phases: document.querySelectorAll(".phase-cell").length,
    service: document.querySelector("#metadata-service").value,
    name: document.querySelector('[data-role="phase-name"]').value,
    stored: localStorage.getItem("serviceBlueprintBuilder.standalone.v1"),
  })`);
  assert.equal(restored.phases, 1);
  assert.equal(restored.service, "");
  assert.equal(restored.name, "");
  assert.equal(restored.stored, null);
  console.log("✓ restauración de plantilla incorporada");

  const storageFallback = await evaluate(`(async () => {
    Storage.prototype.setItem = () => { throw new DOMException("Bloqueado", "SecurityError"); };
    const service = document.querySelector("#metadata-service");
    service.value = "Sesión sin almacenamiento";
    service.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#add-phase").click();
    await new Promise((resolve) => setTimeout(resolve, 550));
    return {
      service: document.querySelector("#metadata-service").value,
      phases: document.querySelectorAll(".phase-cell").length,
      status: document.querySelector("#session-status-text").textContent,
    };
  })()`);
  assert.equal(storageFallback.service, "Sesión sin almacenamiento");
  assert.equal(storageFallback.phases, 2);
  assert.match(storageFallback.status, /Almacenamiento local no disponible/);
  console.log("✓ funcionamiento en memoria cuando localStorage rechaza escrituras");

  await send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await send("Page.reload", { ignoreCache: true });
  await delay(500);
  assert.equal(await evaluate(`location.protocol`), "file:");
  assert.equal(await evaluate(`Boolean(document.querySelector(".blueprint-table"))`), true);
  assert.deepEqual(await evaluate(`performance.getEntriesByType("resource").map((entry) => entry.name)`), []);
  console.log("✓ recarga offline sin solicitudes de red");

  assert.deepEqual(exceptions, []);
  assert.deepEqual(consoleErrors, []);
  console.log("✓ sin excepciones JavaScript ni errores de consola");
} finally {
  socket.close();
}
