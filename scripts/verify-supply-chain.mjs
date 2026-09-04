import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProductionSbom } from "./generate-sbom.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedManifestKeys = ["artifact", "commit", "package", "repository", "sbom", "schemaVersion"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function parseArguments(arguments_) {
  const [mode, ...rest] = arguments_;
  if (!["create", "verify"].includes(mode)) {
    throw new Error("usage: verify-supply-chain.mjs <create|verify> [options]");
  }
  const values = { mode };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined || values[key] !== undefined) {
      throw new Error(`invalid or duplicate argument: ${key ?? "<missing>"}`);
    }
    values[key] = value;
  }
  const required = mode === "create"
    ? ["--artifact", "--sbom", "--output", "--repository", "--commit"]
    : ["--artifact", "--sbom", "--manifest"];
  for (const key of required) {
    if (values[key] === undefined) throw new Error(`${key} is required for ${mode}`);
  }
  const allowed = new Set([...required, ...(mode === "verify" ? ["--formula"] : [])]);
  for (const key of Object.keys(values).filter((key) => key.startsWith("--"))) {
    if (!allowed.has(key)) throw new Error(`unsupported argument for ${mode}: ${key}`);
  }
  return values;
}

function parsePackageIdentity(sbom) {
  if (sbom?.spdxVersion !== "SPDX-2.3" || typeof sbom.name !== "string") {
    throw new Error("SBOM is not SPDX 2.3");
  }
  const separator = sbom.name.lastIndexOf("@");
  if (separator <= 0 || separator === sbom.name.length - 1) {
    throw new Error("SBOM root package identity is invalid");
  }
  return { name: sbom.name.slice(0, separator), version: sbom.name.slice(separator + 1) };
}

function assertRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("repository must be an owner/name identity");
  }
}

function assertCommit(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) throw new Error("commit must be a full lowercase SHA");
}

function artifactRecord(path, bytes) {
  return { name: basename(path), sha256: sha256(bytes), bytes: bytes.length };
}

async function assertSbomMatchesProductionLock(sbom) {
  const [packageBytes, lockBytes, shrinkwrapBytes] = await Promise.all([
    readFile(resolve(sourceRoot, "package.json")),
    readFile(resolve(sourceRoot, "package-lock.json")),
    readFile(resolve(sourceRoot, "npm-shrinkwrap.json")),
  ]);
  if (!lockBytes.equals(shrinkwrapBytes)) {
    throw new Error("package-lock.json and npm-shrinkwrap.json differ");
  }
  const expected = buildProductionSbom({
    packageJson: JSON.parse(packageBytes),
    lockfile: JSON.parse(lockBytes),
    lockBytes,
    created: sbom?.creationInfo?.created,
  });
  if (JSON.stringify(sbom) !== JSON.stringify(expected)) {
    throw new Error("SBOM does not match the exact locked production closure");
  }
}

function assertManifestShape(manifest) {
  if (!exactKeys(manifest, expectedManifestKeys) ||
      manifest.schemaVersion !== "apn.release-manifest.v1" ||
      !exactKeys(manifest.package, ["name", "version"]) ||
      !exactKeys(manifest.artifact, ["bytes", "name", "sha256"]) ||
      !exactKeys(manifest.sbom, ["bytes", "format", "name", "sha256"]) ||
      manifest.sbom.format !== "SPDX-2.3") {
    throw new Error("release manifest shape is invalid");
  }
  assertRepository(manifest.repository);
  assertCommit(manifest.commit);
  for (const record of [manifest.artifact, manifest.sbom]) {
    if (!/^[0-9a-f]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 1 ||
        basename(record.name) !== record.name) {
      throw new Error("release manifest artifact identity is invalid");
    }
  }
}

function assertFormula(formula, manifest) {
  const lines = formula.split(/\r?\n/);
  const urlDeclarations = lines.filter((line) => /^\s*url\b/.test(line));
  const digestDeclarations = lines.filter((line) => /^\s*sha256\b/.test(line));
  if (urlDeclarations.length !== 1 || digestDeclarations.length !== 1) {
    throw new Error("Formula must declare exactly one URL and SHA-256 digest");
  }
  const url = urlDeclarations[0].match(/^\s*url\s+"([^"]+)"\s*$/)?.[1];
  const digest = digestDeclarations[0].match(/^\s*sha256\s+"([0-9a-f]{64})"\s*$/)?.[1];
  if (url === undefined) throw new Error("Formula URL declaration must be one static quoted value");
  if (digest === undefined) throw new Error("Formula SHA-256 declaration must be one exact static digest");
  const expectedUrl = `https://github.com/${manifest.repository}/releases/download/v${manifest.package.version}/${manifest.artifact.name}`;
  if (url !== expectedUrl) throw new Error("Formula URL is not the exact versioned release artifact");
  if (digest !== manifest.artifact.sha256) throw new Error("Formula SHA-256 digest differs from the release manifest");
}

async function createManifest(arguments_) {
  assertRepository(arguments_["--repository"]);
  assertCommit(arguments_["--commit"]);
  const [artifactBytes, sbomBytes] = await Promise.all([
    readFile(resolve(arguments_["--artifact"])),
    readFile(resolve(arguments_["--sbom"])),
  ]);
  const sbomDocument = JSON.parse(sbomBytes);
  const identity = parsePackageIdentity(sbomDocument);
  await assertSbomMatchesProductionLock(sbomDocument);
  const artifact = artifactRecord(arguments_["--artifact"], artifactBytes);
  const sbom = artifactRecord(arguments_["--sbom"], sbomBytes);
  const expectedArtifactName = `nuanu-ai-apn-${identity.version}.tgz`;
  const expectedSbomName = `nuanu-ai-apn-${identity.version}.spdx.json`;
  if (artifact.name !== expectedArtifactName || sbom.name !== expectedSbomName) {
    throw new Error("artifact or SBOM filename differs from the package version");
  }
  const manifest = {
    schemaVersion: "apn.release-manifest.v1",
    repository: arguments_["--repository"],
    commit: arguments_["--commit"],
    package: identity,
    artifact,
    sbom: { ...sbom, format: "SPDX-2.3" },
  };
  await writeFile(resolve(arguments_["--output"]), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  process.stdout.write(`wrote release manifest for ${artifact.name}\n`);
}

async function verifyManifest(arguments_) {
  const [artifactBytes, sbomBytes, manifestBytes] = await Promise.all([
    readFile(resolve(arguments_["--artifact"])),
    readFile(resolve(arguments_["--sbom"])),
    readFile(resolve(arguments_["--manifest"])),
  ]);
  const manifest = JSON.parse(manifestBytes);
  assertManifestShape(manifest);
  const sbomDocument = JSON.parse(sbomBytes);
  const identity = parsePackageIdentity(sbomDocument);
  await assertSbomMatchesProductionLock(sbomDocument);
  if (identity.name !== manifest.package.name || identity.version !== manifest.package.version) {
    throw new Error("SBOM package identity differs from the release manifest");
  }
  const actualArtifact = artifactRecord(arguments_["--artifact"], artifactBytes);
  const actualSbom = artifactRecord(arguments_["--sbom"], sbomBytes);
  for (const [label, expected, actual] of [
    ["artifact", manifest.artifact, actualArtifact],
    ["SBOM", manifest.sbom, actualSbom],
  ]) {
    if (expected.name !== actual.name || expected.sha256 !== actual.sha256 || expected.bytes !== actual.bytes) {
      throw new Error(`${label} digest, size or filename differs from the release manifest`);
    }
  }
  if (arguments_["--formula"] !== undefined) {
    assertFormula(await readFile(resolve(arguments_["--formula"]), "utf8"), manifest);
  }
  process.stdout.write(`verified release manifest for ${manifest.artifact.name}\n`);
}

const arguments_ = parseArguments(process.argv.slice(2));
const operation = arguments_.mode === "create" ? createManifest : verifyManifest;
operation(arguments_).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
