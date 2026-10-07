/**
 * Smoke: an app Worker that uses `@stwrd-auth/workers` bundles for deployment.
 * `wrangler deploy --dry-run` does everything a deploy does short of talking to
 * Cloudflare (it needs no account or token): it resolves the package the way a
 * consumer does (through its `exports`, the built `dist`), bundles it and reads
 * the config. What it cannot say is whether Cloudflare accepts the upload; that
 * stays unverified until a real deploy.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const APP = here("../smoke/app");
const PACKAGE = here("../..");
// The workspace root is the closest ancestor that has the tools installed.
function findWorkspace(from: string): string {
  for (let directory = from; ; directory = dirname(directory)) {
    if (existsSync(join(directory, "node_modules/wrangler/bin/wrangler.js"))) return directory;
    if (dirname(directory) === directory) throw new Error("wrangler is not installed in any parent directory");
  }
}
const WORKSPACE = findWorkspace(PACKAGE);
const WRANGLER = join(WORKSPACE, "node_modules/wrangler/bin/wrangler.js");
const TSC = join(WORKSPACE, "node_modules/typescript/bin/tsc");
let scratch: string;

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd,
    encoding: "utf8",
    // No telemetry, and nothing written to the home directory.
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(scratch, "logs"), XDG_CONFIG_HOME: join(scratch, "config"), CI: "1", NO_COLOR: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function dryRun(config: string, outdir: string) {
  return run(WRANGLER, ["deploy", "--dry-run", "-c", config, "--outdir", outdir], APP);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "stwrd-workers-smoke-"));
  // The app imports the package the way a consumer does: through `dist`.
  const built = run(TSC, ["-b", join(PACKAGE, "tsconfig.json")], WORKSPACE);
  expect(built.output).toBe("");
  expect(built.status).toBe(0);
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("wrangler deploy --dry-run", () => {
  it("bundles a Worker that uses @stwrd-auth/workers, with the Durable Object bound", () => {
    const outdir = join(scratch, "good");
    const result = dryRun("wrangler.jsonc", outdir);
    expect(result.output).toContain("Total Upload");
    expect(result.output).toMatch(/env\.STWRD_SESSIONS \(StwrdSessionObject\)\s+Durable Object/);
    expect(result.output).not.toMatch(/nodejs_compat/);
    expect(result.status).toBe(0);

    const bundle = readFileSync(join(outdir, "index.js"), "utf8");
    // The class the binding names is exported by the Worker.
    expect(bundle).toMatch(/export \{[^}]*\bStwrdSessionObject\b[^}]*\}/);
    // And the whole bundle needs from the runtime only `node:crypto` and
    // `cloudflare:workers`: no Express, no `node:http`, no `pg`.
    const specifiers = new Set([...bundle.matchAll(/(?:from|import\()\s*"([a-z]+:[^"]+)"/g)].map((match) => match[1]));
    expect([...specifiers].sort()).toEqual(["cloudflare:workers", "node:crypto"]);
    expect(bundle).not.toMatch(/\bexpress\b/);
  }, 120_000);

  // Two controls, one variable each, so the warning below is not explained by two changes at once:
  // the flag (no flag, a date from 2026-08-04 on: no warning), then the date (the same, an older one: warning).
  it("(control, the flag) needs no flag on a compatibility date from 2026-08-04 on: wrangler turns nodejs_compat on", () => {
    const result = dryRun("wrangler.no-flag.jsonc", join(scratch, "no-flag"));
    expect(result.output).toContain("Total Upload");
    expect(result.output).not.toMatch(/nodejs_compat/);
    expect(result.status).toBe(0);
  }, 120_000);

  it("(control, the date) warns about nodejs_compat when the flag is missing on an older compatibility date", () => {
    // Without this, the absence of the warning above would prove nothing.
    const result = dryRun("wrangler.no-compat.jsonc", join(scratch, "no-compat"));
    expect(result.output).toMatch(/nodejs_compat/);
  }, 120_000);
});
