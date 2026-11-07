/** Static source contract only: no application, browser, build or runtime scenarios are executed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createSurfaceAnalysis } from "./adaptive-surface-analysis.mjs";

const rootOption = process.argv.indexOf("--root");
if (rootOption >= 0 && !process.argv[rootOption + 1]) throw new Error("--root requires a source directory");
const root = rootOption >= 0 ? path.resolve(process.argv[rootOption + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "lib/adaptive-surface-contract.json"), "utf8"));
const kinds = new Set(contract.surfaceKinds);
const overlayClasses = new Set(contract.overlayClasses), cardClasses = new Set(contract.cardClasses);
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const diagnostics = [];
let marked = 0;
const filenames = [...walk(path.join(root, "components")), ...walk(path.join(root, "app"))].filter(name => name.endsWith(".tsx"));
const analysis = createSurfaceAnalysis(root, filenames);
for (const filename of filenames) {
  const source = analysis.program.getSourceFile(filename);
  const report = (node, reason, classes) => diagnostics.push({ file: path.relative(root, filename).replaceAll("\\", "/"),
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason, classes });
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[a-z]/.test(node.tagName.getText(source))) {
      const attributes = analysis.attributes(node);
      const classes = analysis.classParts(attributes.get("className")).flatMap(value => value.split(/\s+/)).filter(Boolean);
      const marker = attributes.has("data-adaptive-surface");
      const markerValues = analysis.strings(attributes.get("data-adaptive-surface")) || [];
      const roles = analysis.strings(attributes.get("role")) || [];
      const modals = analysis.strings(attributes.get("aria-modal")) || [];
      const semantic = roles.includes("dialog") || modals.includes("true");
      const alwaysSemantic = roles.length > 0 && roles.every(value => value === "dialog")
        || modals.length > 0 && modals.every(value => value === "true");
      const positions = analysis.positions(attributes.get("style"));
      const fixed = positions.includes("fixed") || classes.some(name => name.split(":").at(-1).replace(/^!|!$/g, "") === "fixed" || analysis.isFixedClass(name));
      const namedSurface = classes.some(value => /(?:^|-)(?:overlay|backdrop|dialog|sheet|drawer|mask)$/.test(analysis.className(value)));
      const standardOverlay = classes.some(value => overlayClasses.has(value));
      const standardCard = classes.some(value => cardClasses.has(value));
      if (marker) {
        marked++;
        if (!markerValues.length || markerValues.some(value => !kinds.has(value))) report(node, "Declare supported literal surface kinds (conditional literal kinds are allowed)", classes);
        else if (markerValues.some(value => ["decoration", "content"].includes(value)) && semantic) report(node, "A semantic dialog cannot opt out as decoration/content", classes);
      } else if (fixed && !standardOverlay && !standardCard && !alwaysSemantic) {
        report(node, "A fixed layer (CSS/inline/variable/spread) must declare a surface kind or explicit decoration/content opt-out", classes);
      } else if (namedSurface && !standardOverlay && !standardCard && !alwaysSemantic) {
        report(node, "A custom surface needs an explicit kind; suffix/z-index guessing is not supported", classes);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const issue of source.parseDiagnostics) report(source, ts.flattenDiagnosticMessageText(issue.messageText, " "), []);
}
if (process.argv.includes("--json")) console.log(JSON.stringify({ marked, diagnostics }));
else {
  for (const issue of diagnostics) console.error(`${issue.file}:${issue.line}: ${issue.reason} (${issue.classes.join(" ")})`);
  console.log(`Adaptive surface source contract: ${marked} explicit declarations, ${diagnostics.length} issues.`);
}
process.exitCode = diagnostics.length ? 1 : 0;
