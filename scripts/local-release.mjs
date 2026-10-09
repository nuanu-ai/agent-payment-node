import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const repository = "nuanu-ai/agent-payment-node";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`local release command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}`);
  return result.stdout;
}
export function assertUnusedResponses(version, responses) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) throw new Error("version must be canonical X.Y.Z");
  if (responses.length !== 2 || responses.some(row => row.status !== 404)) {
    throw new Error("release or tag already exists, or its absence could not be verified; immutable version refused");
  }
}
async function unused(version) {
  assertUnusedResponses(version, [{ status: 404 }, { status: 404 }]);
  const paths = [`git/ref/tags/v${version}`, `releases/tags/v${version}`];
  const responses = paths.map(path => {
    const result = spawnSync("gh", ["api", `repos/${repository}/${path}`], { cwd: root, encoding: "utf8" });
    let body; try { body = JSON.parse(result.stdout); } catch { throw new Error("GitHub absence check returned no JSON response"); }
    if (result.status !== 1 || !/HTTP 404/u.test(result.stderr) || body.status !== "404") {
      return { status: 0 };
    }
    return { status: 404, path };
  });
  assertUnusedResponses(version, responses);
  return { schemaVersion: "apn.local-release-eligibility.v1", repository, version, tag: `v${version}`,
    checkedAt: new Date().toISOString(), checks: responses, unusedAtCheck: true };
}
export async function verifyArchive(archive, expected, sourceFiles) {
  if (expected.sha256 !== undefined && digest(await readFile(archive)) !== expected.sha256) throw new Error("archive digest differs from expected release manifest");
  const listed = run("tar", ["-tzf", archive]).trim().split("\n").filter(name => !name.endsWith("/"));
  if (new Set(listed).size !== listed.length || listed.some(name => !name.startsWith("package/") || name.includes("..") || name.includes("\\"))) {
    throw new Error("archive contains duplicate or unsafe member paths");
  }
  const packageJson = JSON.parse(run("tar", ["-xOf", archive, "package/package.json"]));
  if (packageJson.name !== "@nuanu-ai/apn" || packageJson.version !== expected.version ||
    JSON.stringify(packageJson.os) !== '["darwin"]' || JSON.stringify(packageJson.cpu) !== '["arm64"]') {
    throw new Error("archive embedded version, identity or supported platform differs");
  }
  if (basename(archive) !== `nuanu-ai-apn-${expected.version}.tgz`) throw new Error("archive filename differs from version");
  const paths = sourceFiles.map(row => `package/${row.path}`).sort();
  if (JSON.stringify([...listed].sort()) !== JSON.stringify(paths)) throw new Error("archive member set differs from source pack manifest");
  for (const name of paths) {
    const archived = spawnSync("tar", ["-xOf", archive, name], { maxBuffer: 32 * 1024 * 1024 });
    if (archived.status !== 0 || !archived.stdout.equals(await readFile(resolve(expected.sourceRoot, name.slice(8))))) {
      throw new Error(`archive member bytes differ from reviewed source: ${name}`);
    }
  }
}
function arguments_(argv) {
  const [mode, ...args] = argv, values = { mode };
  if (!["check-version", "prepare", "verify"].includes(mode)) throw new Error("usage: local-release.mjs <check-version|prepare|verify> --version X.Y.Z --output <new-directory> [--commit <full-sha>] [--formula <path>]");
  for (let i = 0; i < args.length; i += 2) {
    if (!["--version", "--output", "--commit", "--formula"].includes(args[i]) || args[i + 1] === undefined || values[args[i]]) throw new Error("invalid or duplicate local release argument");
    values[args[i]] = args[i + 1];
  }
  if (!values["--version"] || !values["--output"]) throw new Error("version and output are required");
  if (mode !== "check-version" && !/^[0-9a-f]{40}$/u.test(values["--commit"] ?? "")) throw new Error("full expected commit is required");
  return values;
}
async function sourceIdentity(args) {
  const origin = run("git", ["remote", "get-url", "origin"]).trim();
  if (!["https://github.com/nuanu-ai/agent-payment-node.git", "git@github.com:nuanu-ai/agent-payment-node.git"].includes(origin)) throw new Error("source origin is not the declared release repository");
  const actual = run("git", ["rev-parse", "HEAD"]).trim();
  if (actual !== args["--commit"]) throw new Error("source HEAD differs from expected commit");
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(path => path && path !== "node_modules");
  if (run("git", ["status", "--porcelain", "--untracked-files=no"]).trim() || untracked.length > 0) throw new Error("release source or dist is dirty");
  const pkg = JSON.parse(await readFile(resolve(root, "package.json")));
  if (pkg.version !== args["--version"] || pkg.name !== "@nuanu-ai/apn") throw new Error("source version differs from release target; prepare only after the reviewed version commit");
}
async function verify(args) {
  await sourceIdentity(args);
  const output = resolve(args["--output"]), version = args["--version"];
  const artifact = resolve(output, `nuanu-ai-apn-${version}.tgz`), sbom = resolve(output, `nuanu-ai-apn-${version}.spdx.json`);
  const manifest = resolve(output, `nuanu-ai-apn-${version}.release.json`);
  const doc = JSON.parse(await readFile(manifest));
  if (doc.commit !== args["--commit"] || doc.repository !== repository || doc.package.version !== version) throw new Error("release manifest source identity differs");
  run(process.execPath, ["scripts/verify-supply-chain.mjs", "verify", "--artifact", artifact, "--sbom", sbom, "--manifest", manifest,
    ...(args["--formula"] ? ["--formula", resolve(args["--formula"])] : [])]);
  const provenance = JSON.parse(await readFile(resolve(output, `nuanu-ai-apn-${version}.local-provenance.json`)));
  if (provenance.schemaVersion !== "apn.local-release-provenance.v1" || provenance.proofClass !== "unsigned_local_build_and_verification" ||
    provenance.repository !== repository || provenance.commit !== doc.commit || provenance.version !== version ||
    provenance.githubActionsAttestation !== false || JSON.stringify(provenance.signatures) !== "[]" ||
    provenance.published !== false || provenance.installed !== false || provenance.doublePack?.identical !== true ||
    provenance.doublePack.sha256 !== doc.artifact.sha256 || provenance.manifestSha256 !== digest(await readFile(manifest)) ||
    provenance.eligibilitySha256 !== digest(await readFile(resolve(output, "eligibility.json")))) throw new Error("unsigned local provenance identity differs");
  for (const name of ["pack-one", "pack-two"]) {
    if (!(await readFile(resolve(output, name, basename(artifact)))).equals(await readFile(artifact))) throw new Error("retained double pack bytes differ");
  }
  if (!Array.isArray(provenance.records) || provenance.records.length !== 7) throw new Error("local gate record set differs");
  for (const [index, record] of provenance.records.entries()) {
    if (record.result !== "passed" || record.log !== `gate-${index + 1}.log` || record.sha256 !== digest(await readFile(resolve(output, record.log)))) {
      throw new Error("retained local gate evidence digest differs");
    }
  }
  const pack = JSON.parse(run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"]))[0];
  await verifyArchive(artifact, { version, sourceRoot: root, sha256: doc.artifact.sha256 }, pack.files);
  process.stdout.write(`${JSON.stringify({ verified: true, commit: doc.commit, artifact, sha256: doc.artifact.sha256,
    formulaVerified: Boolean(args["--formula"]), githubActionsAttestation: false, signing: "unsigned-local-evidence" })}\n`);
}
async function main(args) {
  if (args.mode === "verify") return await verify(args);
  const eligibility = await unused(args["--version"]);
  const output = resolve(args["--output"]);
  if (args.mode === "prepare") await sourceIdentity(args);
  await mkdir(output, { recursive: false });
  await writeFile(resolve(output, "eligibility.json"), `${JSON.stringify(eligibility, null, 2)}\n`, { flag: "wx" });
  if (args.mode === "check-version") { process.stdout.write(`${resolve(output, "eligibility.json")}\n`); return; }
  if (process.platform !== "darwin" || process.arch !== "arm64" || process.version !== "v24.15.0") throw new Error("release prepare requires macOS arm64 and pinned Node 24.15.0");
  const gates = [
    ["npm", ["run", "test:core"]],
    [process.execPath, ["--test", "tests/packaging/supply-chain.test.mjs", "tests/packaging/platform-support.test.mjs"]],
    ...["metamask-sdk", "tron-utils", "relay-order-id", "smart-account"].map(name => ["npm", ["run", `build:${name}:check`]]),
    ["npm", ["audit", "--omit=dev", "--audit-level=low", "--json"]],
  ];
  const records = [];
  for (const [index, [command, argv]] of gates.entries()) {
    const log = run(command, argv), name = `gate-${index + 1}.log`;
    await writeFile(resolve(output, name), log, { flag: "wx" });
    records.push({ command: [command === process.execPath ? "node" : command, ...argv], result: "passed", log: name, sha256: digest(log) });
  }
  await sourceIdentity(args); // also proves tracked source/dist parity after build
  const packs = [];
  for (const name of ["pack-one", "pack-two"]) {
    const directory = resolve(output, name); await mkdir(directory);
    const result = run("npm", ["pack", "--ignore-scripts", "--pack-destination", directory, "--json"]);
    await writeFile(resolve(output, `${name}.json`), result, { flag: "wx" }); packs.push(JSON.parse(result)[0]);
  }
  const version = args["--version"], artifactName = `nuanu-ai-apn-${version}.tgz`;
  if (packs.some(pack => pack.filename !== artifactName || pack.version !== version)) throw new Error("npm pack target identity differs");
  const bytes = await readFile(resolve(output, "pack-one", artifactName));
  if (!bytes.equals(await readFile(resolve(output, "pack-two", artifactName)))) throw new Error("double pack bytes differ");
  const artifact = resolve(output, artifactName); await writeFile(artifact, bytes, { flag: "wx" });
  await verifyArchive(artifact, { version, sourceRoot: root }, packs[0].files);
  const sbom = resolve(output, `nuanu-ai-apn-${version}.spdx.json`), manifest = resolve(output, `nuanu-ai-apn-${version}.release.json`);
  run(process.execPath, ["scripts/generate-sbom.mjs", "--output", sbom, "--source-date-epoch", run("git", ["show", "-s", "--format=%ct", args["--commit"]]).trim()]);
  run(process.execPath, ["scripts/verify-supply-chain.mjs", "create", "--artifact", artifact, "--sbom", sbom, "--output", manifest, "--repository", repository, "--commit", args["--commit"]]);
  const provenance = { schemaVersion: "apn.local-release-provenance.v1", proofClass: "unsigned_local_build_and_verification",
    repository, commit: args["--commit"], version, platform: "darwin-arm64", node: process.version,
    githubActionsAttestation: false, signatures: [], published: false, installed: false,
    limitation: "Local unsigned evidence has no GitHub Actions OIDC attestation or independently authenticated builder signature.",
    doublePack: { identical: true, sha256: digest(bytes) },
    records, eligibilitySha256: digest(await readFile(resolve(output, "eligibility.json"))),
    manifestSha256: digest(await readFile(manifest)) };
  await writeFile(resolve(output, `nuanu-ai-apn-${version}.local-provenance.json`), `${JSON.stringify(provenance, null, 2)}\n`, { flag: "wx" });
  await verify(args);
  process.stdout.write(`${output}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(arguments_(process.argv.slice(2))).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
