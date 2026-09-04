import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceRoot = resolve(import.meta.dirname, "../..");
const generateSbom = resolve(sourceRoot, "scripts/generate-sbom.mjs");
const verifySupplyChain = resolve(sourceRoot, "scripts/verify-supply-chain.mjs");
const supplyChainWorkflow = resolve(sourceRoot, ".github/workflows/supply-chain.yml");
const releaseWorkflow = resolve(sourceRoot, ".github/workflows/release.yml");

const requiredPolicyFiles = [
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/workflows/release.yml",
  ".github/workflows/supply-chain.yml",
  "SECURITY.md",
  "scripts/generate-sbom.mjs",
  "scripts/verify-supply-chain.mjs",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function textIfPresent(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function jobBlock(workflow, jobName) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function runNode(script, arguments_) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
}

test("repository declares the complete F-002 policy and workflow surface", () => {
  const missing = requiredPolicyFiles.filter((path) => !existsSync(resolve(sourceRoot, path)));
  assert.deepEqual(missing, [], `missing F-002 controls: ${missing.join(", ")}`);

  const owners = textIfPresent(resolve(sourceRoot, ".github/CODEOWNERS"));
  const security = textIfPresent(resolve(sourceRoot, "SECURITY.md"));
  const dependabot = textIfPresent(resolve(sourceRoot, ".github/dependabot.yml"));
  assert.match(owners, /^\*\s+@[A-Za-z0-9-]+/m);
  assert.match(security, /privately report a security vulnerability/i);
  for (const ecosystem of ["npm", "cargo", "github-actions"]) {
    assert.match(dependabot, new RegExp(`package-ecosystem:\\s*["']?${ecosystem}["']?`));
  }
});

test("workflow dependencies are GitHub-owned and pinned to full commit SHAs", () => {
  const workflowTexts = [
    textIfPresent(supplyChainWorkflow),
    textIfPresent(releaseWorkflow),
  ];
  const actionRefs = workflowTexts.flatMap((workflow) =>
    [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]));
  assert.ok(actionRefs.length >= 8, "expected pinned actions in both workflows");
  for (const actionRef of actionRefs) {
    assert.match(actionRef, /^actions\/[a-z0-9-]+@[0-9a-f]{40}$/);
  }
  for (const workflow of workflowTexts) {
    assert.match(workflow, /^permissions:\n  contents: read$/m);
    assert.doesNotMatch(workflow, /pull-requests:\s*write/);
    const checkoutCount = (workflow.match(/persist-credentials:\s*false/g) ?? []).length;
    assert.ok(checkoutCount >= 1, "checkout must not persist credentials");
  }
});

test("build and attestation permissions are isolated", () => {
  const supplyChain = textIfPresent(supplyChainWorkflow);
  const release = textIfPresent(releaseWorkflow);
  const supplyBuild = jobBlock(supplyChain, "build");
  const attest = jobBlock(supplyChain, "attest");
  const releaseBuild = jobBlock(release, "build");
  const publish = jobBlock(release, "publish");

  for (const block of [supplyBuild, releaseBuild]) {
    assert.match(block, /permissions:\n\s+contents: read/);
    assert.doesNotMatch(block, /:\s*write/);
    assert.match(block, /npm ci --ignore-scripts/);
  }
  assert.match(attest, /id-token:\s*write/);
  assert.match(attest, /attestations:\s*write/);
  assert.match(attest, /artifact-metadata:\s*write/);
  assert.doesNotMatch(attest, /contents:\s*write/);
  assert.match(publish, /contents:\s*write/);
  assert.match(publish, /id-token:\s*write/);
  assert.match(publish, /attestations:\s*write/);
  assert.match(publish, /artifact-metadata:\s*write/);
  for (const block of [releaseBuild, publish]) {
    assert.match(block, /if:\s*github\.ref == 'refs\/heads\/main'/);
    assert.match(block, /git merge-base --is-ancestor "\$EXPECTED_COMMIT" "origin\/\$DEFAULT_BRANCH"/);
  }
  assert.doesNotMatch(publish, /node scripts\//);
  assert.doesNotMatch(publish, /npm (?:ci|run|pack)/);
  assert.match(publish, /sha256sum/);
  assert.match(release, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(release, /^\s+push:/m);
});

test("production SPDX SBOM is deterministic and bound to the lockfiles", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apn-sbom-contract-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const first = join(root, "first.spdx.json");
  const second = join(root, "second.spdx.json");
  const epoch = "1788547200";
  const firstRun = runNode(generateSbom, ["--output", first, "--source-date-epoch", epoch]);
  assert.equal(firstRun.status, 0, `${firstRun.stdout}\n${firstRun.stderr}`);
  const secondRun = runNode(generateSbom, ["--output", second, "--source-date-epoch", epoch]);
  assert.equal(secondRun.status, 0, `${secondRun.stdout}\n${secondRun.stderr}`);
  const [firstBytes, secondBytes, lockBytes, shrinkwrapBytes] = await Promise.all([
    readFile(first),
    readFile(second),
    readFile(resolve(sourceRoot, "package-lock.json")),
    readFile(resolve(sourceRoot, "npm-shrinkwrap.json")),
  ]);
  assert.deepEqual(firstBytes, secondBytes);
  assert.deepEqual(lockBytes, shrinkwrapBytes);
  const sbom = JSON.parse(firstBytes);
  assert.doesNotMatch(textIfPresent(generateSbom), /localeCompare/);
  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.equal(sbom.documentNamespace.endsWith(sha256(lockBytes)), true);
  assert.equal(sbom.creationInfo.created, new Date(Number(epoch) * 1000).toISOString());
  const packageJson = JSON.parse(await readFile(resolve(sourceRoot, "package.json"), "utf8"));
  const packages = new Set(sbom.packages.map((entry) => `${entry.name}@${entry.versionInfo}`));
  for (const [name, version] of Object.entries(packageJson.dependencies)) {
    assert.equal(packages.has(`${name}@${version}`), true, `missing production dependency ${name}@${version}`);
  }
  for (const name of ["@modelcontextprotocol/client", "@types/node"]) {
    assert.equal(sbom.packages.some((entry) => entry.name === name), false, `dev-only package leaked: ${name}`);
  }
  assert.equal(packages.has("typescript@5.9.2"), true, "installed production peer closure omitted TypeScript");
});

test("two clean npm packs are byte-identical", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apn-pack-contract-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const first = join(root, "first");
  const second = join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  const firstRun = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", first, "--json"], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  assert.equal(firstRun.status, 0, `${firstRun.stdout}\n${firstRun.stderr}`);
  const secondRun = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", second, "--json"], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  assert.equal(secondRun.status, 0, `${secondRun.stdout}\n${secondRun.stderr}`);
  const firstName = JSON.parse(firstRun.stdout)[0].filename;
  const secondName = JSON.parse(secondRun.stdout)[0].filename;
  assert.equal(firstName, secondName);
  assert.deepEqual(await readFile(join(first, firstName)), await readFile(join(second, secondName)));
});

test("release manifest binds artifact, SBOM, source and Formula digest", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apn-manifest-contract-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const artifact = join(root, "nuanu-ai-apn-0.5.5.tgz");
  const sbom = join(root, "nuanu-ai-apn-0.5.5.spdx.json");
  const manifest = join(root, "nuanu-ai-apn-0.5.5.release.json");
  const formula = join(root, "apn.rb");
  await writeFile(artifact, "deterministic candidate artifact");
  const generated = runNode(generateSbom, [
    "--output", sbom,
    "--source-date-epoch", "1788547200",
  ]);
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  const create = runNode(verifySupplyChain, [
    "create",
    "--artifact", artifact,
    "--sbom", sbom,
    "--output", manifest,
    "--repository", "nuanu-ai/agent-payment-node",
    "--commit", "a".repeat(40),
  ]);
  assert.equal(create.status, 0, `${create.stdout}\n${create.stderr}`);
  const releaseManifest = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(formula, [
    "class Apn < Formula",
    `  url \"https://github.com/nuanu-ai/agent-payment-node/releases/download/v0.5.5/${basename(artifact)}\"`,
    `  sha256 \"${releaseManifest.artifact.sha256}\"`,
    "end",
    "",
  ].join("\n"));
  const verify = runNode(verifySupplyChain, [
    "verify",
    "--artifact", artifact,
    "--sbom", sbom,
    "--manifest", manifest,
    "--formula", formula,
  ]);
  assert.equal(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);

  await writeFile(formula, (await readFile(formula, "utf8")).replace(
    "/download/v0.5.5/",
    "/latest/download/",
  ));
  const mutableUrl = runNode(verifySupplyChain, [
    "verify",
    "--artifact", artifact,
    "--sbom", sbom,
    "--manifest", manifest,
    "--formula", formula,
  ]);
  assert.notEqual(mutableUrl.status, 0);
  assert.match(`${mutableUrl.stdout}\n${mutableUrl.stderr}`, /url|versioned/i);

  await writeFile(formula, (await readFile(formula, "utf8")).replace(
    "/latest/download/",
    "/download/v0.5.5/",
  ));

  await writeFile(formula, (await readFile(formula, "utf8")).replace(
    releaseManifest.artifact.sha256,
    "0".repeat(64),
  ));
  const tampered = runNode(verifySupplyChain, [
    "verify",
    "--artifact", artifact,
    "--sbom", sbom,
    "--manifest", manifest,
    "--formula", formula,
  ]);
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /digest|sha256/i);

  await writeFile(formula, (await readFile(formula, "utf8")).replace(
    "0".repeat(64),
    releaseManifest.artifact.sha256,
  ));
  await writeFile(artifact, "different artifact bytes");
  const replacedArtifact = runNode(verifySupplyChain, [
    "verify",
    "--artifact", artifact,
    "--sbom", sbom,
    "--manifest", manifest,
    "--formula", formula,
  ]);
  assert.notEqual(replacedArtifact.status, 0);
  assert.match(`${replacedArtifact.stdout}\n${replacedArtifact.stderr}`, /artifact.*digest/i);
});
