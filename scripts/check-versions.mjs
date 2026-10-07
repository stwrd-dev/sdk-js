// Checks the release metadata of the workspace:
//   - every package is an `@stwrd-auth/*` package and they all share one version;
//   - internal dependencies are pinned to that exact version;
//   - `repository.directory` matches the package's directory;
//   - when an expected version is given, it is the version of every package.
// Prints the version on success.
//
// Usage: node scripts/check-versions.mjs [expected-version]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const expected = process.argv[2];
const errors = [];

const workspaces = readJson("package.json").workspaces;
const packages = workspaces.map((directory) => ({ directory, manifest: readJson(join(directory, "package.json")) }));
const versions = new Set(packages.map(({ manifest }) => manifest.version));
const [version] = versions;

if (versions.size !== 1) {
  errors.push(`the packages do not share one version: ${packages.map(({ manifest }) => `${manifest.name}@${manifest.version}`).join(", ")}`);
}
if (expected !== undefined && !(versions.size === 1 && version === expected)) {
  errors.push(`expected version ${expected}, found ${[...versions].join(", ")}`);
}
for (const { directory, manifest } of packages) {
  if (!manifest.name.startsWith("@stwrd-auth/")) errors.push(`${directory}: unexpected package name ${manifest.name}`);
  if (manifest.repository?.directory !== directory) {
    errors.push(`${manifest.name}: repository.directory is ${manifest.repository?.directory}, expected ${directory}`);
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (name.startsWith("@stwrd-auth/") && range !== version) {
        errors.push(`${manifest.name}: ${field}.${name} is ${range}, expected the exact version ${version}`);
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
console.log(version);
