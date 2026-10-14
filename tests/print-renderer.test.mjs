import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PHASES_PER_PRINT_PAGE,
  PRINT_LAYERS,
  createPrintFilename,
  createPrintModel,
  paginatePhases,
  printWithTemporaryTitle,
  validateBlueprintForPrint,
} from "../assets/js/print-renderer.js";

function makePhase(index, content = `Contenido ${index}`) {
  return {
    id: `F${index}`,
    name: `Fase ${index}`,
    description: `Descripción ${index}`,
    layers: Object.fromEntries(PRINT_LAYERS.map(({ key }) => [key, [content]])),
  };
}

function makeBlueprint(phaseCount) {
  return {
    metadata: {
      service: "Servicio de prueba",
      owner: "Responsable",
      date: "2026-10-14",
      stage: "To-Be",
      description: "Descripción de prueba",
    },
    phases: Array.from({ length: phaseCount }, (_, index) => makePhase(index + 1)),
  };
}

test("segmenta 1, 4, 5, 8 y 10 fases en grupos completos de hasta cuatro", () => {
  assert.equal(PRINT_LAYERS.length + 1, 7);
  const scenarios = new Map([
    [1, [1]],
    [4, [4]],
    [5, [4, 1]],
    [8, [4, 4]],
    [10, [4, 4, 2]],
  ]);

  for (const [phaseCount, expectedPageSizes] of scenarios) {
    const blueprint = makeBlueprint(phaseCount);
    const model = createPrintModel(blueprint);
    assert.equal(PHASES_PER_PRINT_PAGE, 4);
    assert.deepEqual(
      model.pages.map((page) => page.phases.length),
      expectedPageSizes,
    );
    assert.equal(model.pages.flatMap((page) => page.phases).length, phaseCount);
    assert.deepEqual(
      model.pages.flatMap((page) => page.phases).map((phase) => phase.id),
      Array.from({ length: phaseCount }, (_, index) => `F${index + 1}`),
    );
  }
});

test("permite ajustar el tamaño de página sin reescribir la paginación", () => {
  assert.deepEqual(
    paginatePhases(makeBlueprint(8).phases, 3).map((group) => group.length),
    [3, 3, 2],
  );
});

test("conserva orden, multilínea y celdas vacías sin modificar el estado fuente", () => {
  const blueprint = makeBlueprint(3);
  blueprint.phases[0].layers.customerActions = ["Línea uno", "Línea dos"];
  blueprint.phases[1].layers.supportProcesses = [];
  const original = structuredClone(blueprint);

  blueprint.phases = [blueprint.phases[2], blueprint.phases[0], blueprint.phases[1]];
  const reorderedOriginal = structuredClone(blueprint);
  const model = createPrintModel(blueprint);
  const printed = model.pages.flatMap((page) => page.phases);

  assert.deepEqual(
    printed.map((phase) => phase.name),
    ["Fase 3", "Fase 1", "Fase 2"],
  );
  assert.deepEqual(
    printed.map((phase) => phase.id),
    ["F1", "F2", "F3"],
  );
  assert.deepEqual(printed[1].layers.customerActions, ["Línea uno", "Línea dos"]);
  assert.deepEqual(printed[2].layers.supportProcesses, []);
  assert.deepEqual(blueprint, reorderedOriginal);
  assert.notDeepEqual(blueprint, original);
});

test("acepta un JSON importado válido y refleja una eliminación posterior", () => {
  const imported = JSON.parse(JSON.stringify(makeBlueprint(5)));
  imported.phases.splice(2, 1);
  const model = createPrintModel(imported);

  assert.equal(model.phaseCount, 4);
  assert.equal(model.pageCount, 1);
  assert.deepEqual(
    model.pages[0].phases.map((phase) => phase.name),
    ["Fase 1", "Fase 2", "Fase 4", "Fase 5"],
  );
  assert.deepEqual(
    model.pages[0].phases.map((phase) => phase.id),
    ["F1", "F2", "F3", "F4"],
  );
});

test("distingue errores bloqueantes y advertencias", () => {
  const warningBlueprint = makeBlueprint(1);
  warningBlueprint.metadata.owner = "";
  warningBlueprint.metadata.description = "";
  warningBlueprint.phases[0].layers.systemsTools = [];
  const warningResult = validateBlueprintForPrint(warningBlueprint);
  assert.equal(warningResult.errors.length, 0);
  assert.ok(warningResult.warnings.length >= 3);

  const invalid = makeBlueprint(2);
  invalid.metadata.service = "";
  invalid.phases[0].name = "";
  invalid.phases[1].id = "F1";
  delete invalid.phases[1].layers.backstageActions;
  const invalidResult = validateBlueprintForPrint(invalid);
  assert.ok(invalidResult.errors.some((error) => error.includes("nombre del servicio")));
  assert.ok(invalidResult.errors.some((error) => error.includes("debe tener un nombre")));
  assert.ok(invalidResult.errors.some((error) => error.includes("identificador F2")));
  assert.ok(invalidResult.errors.some((error) => error.includes("Backstage Actions")));
});

test("restaura el título incluso cuando la impresión se cancela o falla", () => {
  const browserDocument = { title: "Blueprint Service Builder" };
  const cancelWindow = { print() {} };
  printWithTemporaryTitle(cancelWindow, browserDocument, "Service_Blueprint_ToBe_Prueba");
  assert.equal(browserDocument.title, "Blueprint Service Builder");

  const failingWindow = {
    print() {
      throw new Error("Cancelada");
    },
  };
  assert.throws(() =>
    printWithTemporaryTitle(failingWindow, browserDocument, "Service_Blueprint_ToBe_Prueba"),
  );
  assert.equal(browserDocument.title, "Blueprint Service Builder");
});

test("genera un nombre de documento legible y seguro", () => {
  assert.equal(
    createPrintFilename('Gestión: solicitudes / HR?'),
    "Service_Blueprint_ToBe_Gestion_solicitudes_HR",
  );
});

test("el renderer de impresión no crea controles editables", async () => {
  const source = await readFile(
    new URL("../assets/js/print-renderer.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /createElement\(["'](?:textarea|button|input)["']\)/);
});
