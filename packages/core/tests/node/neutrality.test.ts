// The core runs on Node and on workerd, so a module under `src/` may only
// import `node:crypto`, `jose` or another module of the core. A `node:http`
// or `node:fs` there would break every Worker that imports the package, and
// the failure would show up at deploy time, not in review. AST sweep, not a
// grep: it sees `import`, `export ... from`,
// `import()` and `require()` alike.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const ALLOWED_PACKAGES = new Set(["node:crypto", "jose"]);

function specifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const visit = (node: import("typescript").Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        found.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// Every module under `src/`, `web/` included, as a path relative to it.
const FILES = (readdirSync(SRC, { recursive: true }) as string[])
  .map((name) => name.split("\\").join("/"))
  .filter((name) => name.endsWith(".ts"))
  .sort();

describe("the core only imports node:crypto, jose and itself", () => {
  it("finds the source modules", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES)("%s", (name) => {
    const stray = specifiers(join(SRC, name)).filter((specifier) => {
      if (specifier.startsWith(".")) {
        return !FILES.includes(posix.join(posix.dirname(name), specifier).replace(/\.js$/, ".ts"));
      }
      return !ALLOWED_PACKAGES.has(specifier);
    });
    expect(stray, `${name} imports outside the allowed set`).toEqual([]);
  });
});

// A Worker has no `process.env`: the environment reaches the core as an
// argument (`configFromEnv(env)`), never through a global. Any reference to
// the `process` identifier or to `globalThis.process` is a read of it.
function readsProcess(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const visit = (node: import("typescript").Node): void => {
    const isProperty = node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
    if (ts.isIdentifier(node) && node.text === "process" && !isProperty) {
      found.push(node.parent.getText(source));
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === "process" && node.expression.getText(source) === "globalThis") {
      found.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the core never reads the global `process`", () => {
  it.each(FILES)("%s", (name) => {
    expect(readsProcess(join(SRC, name)), `${name} reads process`).toEqual([]);
  });
});
