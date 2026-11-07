/** Read-only expression/CSS analysis. Reuses TypeScript binding and Next's PostCSS parser. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve("next/package.json"))("postcss");
const walk = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]) : [];

export function createSurfaceAnalysis(root, sourceFiles) {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, " "));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(sourceFiles, { ...parsed.options, noEmit: true, incremental: false });
  const checker = program.getTypeChecker(); // Symbol lookup only; no emit or semantic diagnostics run.
  const moduleTokens = new Map(), cssModules = new Map(), fixedClasses = new Set();
  function fixedSelectors(css, filename) {
    const names = new Set();
    const tree = postcss.parse(css, { from: filename });
    tree.walkRules(rule => {
      if (!rule.nodes?.some(node => node.type === "decl" && node.prop === "position" && node.value.trim() === "fixed")) return;
      for (const selector of rule.selector.split(",")) {
        // Only the target compound; an ancestor class does not receive a descendant's position.
        const target = selector.trim().split(/\s+|[>+~]/).at(-1) || "";
        for (const match of target.matchAll(/(?<!\\)\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1]);
      }
    });
    return names;
  }
  for (const file of [...walk(path.join(root, "styles")), ...walk(path.join(root, "app"))].filter(file => file.endsWith(".css") && !file.endsWith(".module.css"))) {
    for (const name of fixedSelectors(fs.readFileSync(file, "utf8"), file)) fixedClasses.add(name);
  }
  function unwrap(node) {
    while (node && (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
    return node;
  }
  function declaration(node) {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration || symbol?.declarations?.[0];
  }
  function resolve(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return node;
    seen = new Set(seen).add(node);
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const target = declaration(ts.isPropertyAccessExpression(node) ? node.name : node);
      if (target?.initializer) return resolve(target.initializer, seen);
      if (target && ts.isExportAssignment(target)) return resolve(target.expression, seen);
    }
    if (ts.isCallExpression(node)) {
      const returns = callReturns(node);
      if (returns.length === 1) return resolve(returns[0], seen);
    }
    return node;
  }
  function callReturns(node) {
    let fn = unwrap(node.expression);
    if (ts.isIdentifier(fn) || ts.isPropertyAccessExpression(fn)) {
      const target = declaration(ts.isPropertyAccessExpression(fn) ? fn.name : fn);
      fn = target?.initializer ? unwrap(target.initializer) : target;
    }
    if (!fn || !ts.isFunctionLike(fn) || !fn.body) return [];
    if (!ts.isBlock(fn.body)) return [fn.body];
    const result = [];
    function visit(child) {
      if (ts.isFunctionLike(child)) return;
      if (ts.isReturnStatement(child) && child.expression) result.push(child.expression);
      else ts.forEachChild(child, visit);
    }
    visit(fn.body);
    return result;
  }
  function cssToken(node) {
    if (!node || !(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return null;
    const owner = resolve(node.expression);
    if (!owner || !ts.isIdentifier(owner)) return null;
    const symbol = checker.getSymbolAtLocation(owner);
    const imported = symbol?.declarations?.find(ts.isImportClause);
    const specifier = imported?.parent?.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.endsWith(".module.css")) return null;
    const key = ts.isPropertyAccessExpression(node) ? node.name.text : strings(node.argumentExpression)?.[0];
    if (!key) return null;
    const filename = specifier.text.startsWith("@/") ? path.resolve(root, specifier.text.slice(2))
      : path.resolve(path.dirname(node.getSourceFile().fileName), specifier.text);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return null;
    if (!cssModules.has(filename)) cssModules.set(filename, fixedSelectors(fs.readFileSync(filename, "utf8"), filename));
    const token = `css-module:${encodeURIComponent(filename)}:${key}`;
    moduleTokens.set(token, { name: key, fixed: cssModules.get(filename).has(key) });
    return token;
  }
  function strings(raw, seen = new Set()) {
    let node = unwrap(raw);
    if (!node || seen.has(node)) return null;
    seen = new Set(seen).add(node);
    const token = cssToken(node);
    if (token) return [token];
    const resolved = resolve(node);
    if (resolved !== node) return strings(resolved, seen);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return [node.text];
    if (node.kind === ts.SyntaxKind.TrueKeyword) return ["true"];
    if (node.kind === ts.SyntaxKind.FalseKeyword) return ["false"];
    if (ts.isConditionalExpression(node)) {
      const yes = strings(node.whenTrue, seen), no = strings(node.whenFalse, seen);
      return yes && no ? [...yes, ...no] : null;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = strings(node.left, seen), right = strings(node.right, seen);
      return left && right ? left.flatMap(a => right.map(b => a + b)).slice(0, 32) : null;
    }
    if (ts.isTemplateExpression(node)) {
      let result = [node.head.text];
      for (const span of node.templateSpans) {
        const values = strings(span.expression, seen);
        if (!values) return null;
        result = result.flatMap(a => values.map(b => a + b + span.literal.text)).slice(0, 32);
      }
      return result;
    }
    return null;
  }
  function objectEntries(raw, seen = new Set()) {
    const node = resolve(raw);
    const result = new Map();
    if (!node || seen.has(node) || !ts.isObjectLiteralExpression(node)) return result;
    seen = new Set(seen).add(node);
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) for (const [key, value] of objectEntries(property.expression, seen)) result.set(key, value);
      else if (ts.isPropertyAssignment(property)) {
        const key = ts.isComputedPropertyName(property.name) ? strings(property.name.expression)?.[0] : property.name.text;
        if (key) result.set(key, property.initializer);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(property);
        result.set(property.name.text, symbol?.valueDeclaration?.initializer || property.name);
      }
    }
    return result;
  }
  function classParts(raw, seen = new Set()) {
    const node = unwrap(raw);
    if (!node || seen.has(node)) return [];
    const values = strings(node);
    if (values) return values;
    seen = new Set(seen).add(node);
    const resolved = resolve(node);
    if (resolved !== node) return classParts(resolved, seen);
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.flatMap(span => [...classParts(span.expression, seen), span.literal.text])];
    if (ts.isConditionalExpression(node)) return [...classParts(node.whenTrue, seen), ...classParts(node.whenFalse, seen)];
    if (ts.isBinaryExpression(node)) return [...classParts(node.left, seen), ...classParts(node.right, seen)];
    if (ts.isCallExpression(node)) return [...callReturns(node).flatMap(value => classParts(value, seen)), ...node.arguments.flatMap(arg => classParts(arg, seen))];
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(item => classParts(item, seen));
    if (ts.isObjectLiteralExpression(node)) return [...objectEntries(node).keys()];
    return [];
  }
  function attributes(node) {
    const values = new Map();
    for (const property of node.attributes.properties) {
      if (ts.isJsxAttribute(property)) values.set(property.name.getText(), property.initializer);
      else for (const [key, value] of objectEntries(property.expression)) values.set(key, value);
    }
    return values;
  }
  function positions(raw, seen = new Set()) {
    const node = resolve(raw);
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    if (ts.isConditionalExpression(node)) return [...positions(node.whenTrue, seen), ...positions(node.whenFalse, seen)];
    if (ts.isCallExpression(node)) return callReturns(node).flatMap(value => positions(value, seen));
    return strings(objectEntries(node).get("position")) || [];
  }
  return { program, strings, classParts, attributes, objectEntries, positions,
    className: token => moduleTokens.get(token)?.name || token,
    isFixedClass: token => moduleTokens.get(token)?.fixed || fixedClasses.has(token) };
}
