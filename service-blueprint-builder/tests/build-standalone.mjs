import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(projectRoot, "Service_Blueprint_ToBe_Editable.html");

async function read(relativePath) {
  return readFile(resolve(projectRoot, relativePath), "utf8");
}

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`No se pudo aplicar la transformación: ${label}`);
  return next;
}

function stripExports(source) {
  return source.replace(/\bexport\s+/g, "");
}

const [index, baseCss, blueprintCss, printCss, rendererModule, printModule, appModule, template] =
  await Promise.all([
    read("index.html"),
    read("assets/css/base.css"),
    read("assets/css/blueprint.css"),
    read("assets/css/print.css"),
    read("assets/js/renderer.js"),
    read("assets/js/print-renderer.js"),
    read("assets/js/app.js"),
    read("data/blueprint.json"),
  ]);

const templateObject = JSON.parse(template);
const inlineStyles = `    <style>
      /* base.css */
${baseCss}

      /* blueprint.css */
${blueprintCss}

      /* print.css */
${printCss}
    </style>`;

let editableRenderer = stripExports(rendererModule);
editableRenderer = editableRenderer
  .replace(
    "Abre el proyecto mediante un servidor local para permitir la lectura del archivo JSON.",
    "La aplicación autónoma no pudo inicializarse. Recarga el archivo o restaura una copia válida.",
  )
  .replace('command.textContent = "npx serve .";', 'command.textContent = "Archivo autónomo";');

const printRenderer = stripExports(printModule);

let app = appModule.replace(
  /^import \{ renderBlueprint, renderLoadError \} from "\.\/renderer\.js";\r?\nimport \{[\s\S]*?\} from "\.\/print-renderer\.js";\r?\n\r?\n/,
  "",
);
if (app === appModule) throw new Error("No se pudieron retirar los imports de app.js");

app = replaceOnce(
  app,
  /const DATA_URL = "data\/blueprint\.json";\r?\nconst STORAGE_KEY = "service-blueprint-builder:data:v1";/,
  'const STORAGE_KEY = "serviceBlueprintBuilder.standalone.v1";',
  "clave de almacenamiento autónoma",
);

const stateAnchor = "let previewReturnFocus = null;";
const storageAdapters = `${stateAnchor}
let storageAvailable = true;

function readStoredValue() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    storageAvailable = false;
    console.warn("localStorage no está disponible; la sesión continuará en memoria.", error);
    return null;
  }
}

function writeStoredValue(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    storageAvailable = true;
    return true;
  } catch (error) {
    storageAvailable = false;
    console.warn("No se pudo guardar en localStorage; la sesión continúa en memoria.", error);
    return false;
  }
}

function removeStoredValue() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    storageAvailable = true;
    return true;
  } catch (error) {
    storageAvailable = false;
    console.warn("No se pudo limpiar localStorage; la sesión continúa en memoria.", error);
    return false;
  }
}`;
app = replaceOnce(app, stateAnchor, storageAdapters, "adaptadores de localStorage");

const cloneAnchor = `function clone(value) {
  return JSON.parse(JSON.stringify(value));
}`;
const templateSource = `${cloneAnchor}

function deepFreeze(value) {
  Object.freeze(value);
  Object.values(value).forEach((item) => {
    if (item && typeof item === "object" && !Object.isFrozen(item)) deepFreeze(item);
  });
  return value;
}

const ORIGINAL_BLUEPRINT_TEMPLATE = deepFreeze(${JSON.stringify(templateObject, null, 2)});

function createJsonFilename(serviceName) {
  return createPrintFilename(serviceName).replace(/^Service_Blueprint_/, "Blueprint_") + ".json";
}`;
app = replaceOnce(app, cloneAnchor, templateSource, "plantilla JSON incorporada");

app = replaceOnce(
  app,
  /async function loadTemplate\(\) \{[\s\S]*?\r?\n\}/,
  `function loadTemplate() {
  return normalizeBlueprint(clone(ORIGINAL_BLUEPRINT_TEMPLATE));
}`,
  "carga local de plantilla",
);

app = app
  .replace("localStorage.getItem(STORAGE_KEY)", "readStoredValue()")
  .replace("localStorage.removeItem(STORAGE_KEY)", "removeStoredValue()")
  .replace("localStorage.removeItem(STORAGE_KEY)", "removeStoredValue()");

app = replaceOnce(
  app,
  "    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));",
  `    if (!writeStoredValue(JSON.stringify(validated))) {
      setStatus("error", "Almacenamiento local no disponible; cambios conservados durante esta sesión");
      return false;
    }`,
  "guardado tolerante a fallos",
);

app = replaceOnce(
  app,
  '  setStatus("saved", "Plantilla original restaurada");',
  `  setStatus(
    storageAvailable ? "saved" : "error",
    storageAvailable
      ? "Plantilla original restaurada"
      : "Plantilla restaurada; cambios conservados solo durante esta sesión",
  );`,
  "estado de restauración",
);

app = replaceOnce(
  app,
  /    link\.href = url;\r?\n    link\.download = "blueprint\.json";/,
  `    const jsonFilename = createJsonFilename(exportData.metadata.service);
    link.href = url;
    link.download = jsonFilename;`,
  "nombre de exportación JSON",
);
app = app.replace(
  'setStatus("saved", "Blueprint exportado como blueprint.json");',
  'setStatus("saved", `Blueprint exportado como ${jsonFilename}`);',
);

app = replaceOnce(
  app,
  /    setControlsEnabled\(true\);\r?\n    setStatus\([\s\S]*?\r?\n    \);/,
  `    setControlsEnabled(true);
    if (storageAvailable) {
      setStatus(
        "saved",
        storedBlueprint
          ? "Archivo autónomo · últimos cambios recuperados"
          : "Archivo autónomo · plantilla original cargada",
      );
    } else {
      setStatus(
        "error",
        "Archivo autónomo · almacenamiento no disponible; cambios solo durante esta sesión",
      );
    }`,
  "estado de inicialización autónoma",
);

app = replaceOnce(
  app,
  'elements.file.addEventListener("change", () => importBlueprint(elements.file.files?.[0]));',
  `elements.file.addEventListener("change", async () => {
  const file = elements.file.files?.[0];
  try {
    await importBlueprint(file);
  } finally {
    elements.file.value = "";
  }
});`,
  "reinicio del selector de archivo",
);

const inlineScript = `    <script>
      (() => {
        "use strict";

        /* Renderer editable */
        const EditableRenderer = (() => {
${editableRenderer}
          return { renderBlueprint, renderLoadError };
        })();

        /* Renderer de impresión */
        const PrintRenderer = (() => {
${printRenderer}
          return {
            PHASES_PER_PRINT_PAGE,
            PRINT_LAYERS,
            paginatePhases,
            createPrintModel,
            validateBlueprintForPrint,
            createPrintFilename,
            printWithTemporaryTitle,
            renderPrintPreview,
          };
        })();

        /* Estado, persistencia, fases, JSON, vista previa e inicialización */
        (() => {
          const { renderBlueprint, renderLoadError } = EditableRenderer;
          const {
            createPrintFilename,
            printWithTemporaryTitle,
            renderPrintPreview,
            validateBlueprintForPrint,
          } = PrintRenderer;

${app}
        })();
      })();
    </script>`;

let standalone = index;
standalone = replaceOnce(
  standalone,
  /    <link rel="stylesheet" href="assets\/css\/base\.css" \/>\r?\n    <link rel="stylesheet" href="assets\/css\/blueprint\.css" \/>\r?\n    <link rel="stylesheet" href="assets\/css\/print\.css" \/>/,
  inlineStyles,
  "estilos internos",
);
standalone = replaceOnce(
  standalone,
  '    <script type="module" src="assets/js/app.js"></script>',
  inlineScript,
  "JavaScript interno",
);
standalone = standalone.replace(
  "<!doctype html>",
  "<!doctype html>\n<!-- Archivo autónomo generado desde la versión modular oficial. -->",
);

const forbidden = [
  /<link\b[^>]*\bhref=/i,
  /<script\b[^>]*\bsrc=/i,
  /\bfetch\s*\(/,
  /^\s*import\s/m,
  /\bfrom\s+["']\.\//,
  /\beval\s*\(/,
];
for (const pattern of forbidden) {
  if (pattern.test(standalone)) throw new Error(`Dependencia no permitida en salida: ${pattern}`);
}

await writeFile(outputPath, standalone, "utf8");
console.log(outputPath);
