import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson, isPlainRecord, sha256 } from "../canonical.js";
import { SmartAccountGaslessOperationRepository } from "./operation-repository.js";
import { validateSmartAccountGaslessReceipt } from "./receipt.js";
import { saError } from "./reasons.js";
/** These runtime bytes bind both new-family parsing and the shared lookup/guard/recovery routes. */
export const SA_RECOVERY_REQUIRED_ARTIFACTS = [
    "core", "runtime", "runtime-factory", "operation-service", "encrypted-smart-account-gasless-material-store",
    "smart-account-erc7710/intent", "smart-account-erc7710/engine", "smart-account-erc7710/validation",
    ...["model", "ports", "operation-model", "schema", "integrity", "reasons", "registry", "registry-data",
        "operation-repository", "transitions", "receipt", "owner", "policy", "prepare", "execution", "service",
        "runtime", "material", "provider", "recovery-gate", "chain/abi", "chain/rpc", "chain/snapshot", "chain/allowance",
        "chain/transaction", "chain/receipt", "chain/redemption", "chain/scan", "chain/observation"]
        .map(path => `smart-account-gasless/${path}`),
].map(path => `dist/${path}.js`);
const MAX_FILE_BYTES = 64 * 1024 * 1024;
function incompatible() { throw saError("sa_gasless_archive_incompatible"); }
/** Read-only selection preflight. It never imports or invokes a target executable, initializes state, or repairs receipts. */
export async function selectSmartAccountGaslessRecoveryArchive(input) {
    try {
        if (!isPlainRecord(input) || Object.keys(input).sort().join(",") !==
            "archive,manifest,manifestSha256,packageRoot,stateRoot" || !digest(input.manifestSha256))
            incompatible();
        await directory(input.stateRoot);
        await directory(input.packageRoot);
        const records = new RecoveryJournalReader(input.stateRoot);
        const before = await records.snapshot(), stateDigest = before.digest;
        const bytes = await regular(input.manifest, 2 * 1024 * 1024);
        if (sha256(bytes) !== input.manifestSha256)
            incompatible();
        const manifest = parseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
        if (manifest.archive !== input.archive || manifest.packageRoot !== input.packageRoot ||
            sha256(await regular(input.archive, MAX_FILE_BYTES)) !== manifest.archiveSha256)
            incompatible();
        const paths = new Map(manifest.files.map(file => [file.path, file]));
        const installed = await inventory(input.packageRoot);
        if (canonicalJson([...paths.keys()].sort()) !== canonicalJson(installed))
            incompatible();
        for (const file of manifest.files) {
            const data = await regular(join(input.packageRoot, file.path), MAX_FILE_BYTES);
            if (data.length !== file.bytes || sha256(data) !== file.sha256)
                incompatible();
        }
        let supportsFamily = true;
        const requiredHashes = {};
        for (const path of SA_RECOVERY_REQUIRED_ARTIFACTS) {
            const file = paths.get(path);
            if (file === undefined) {
                supportsFamily = false;
                continue;
            }
            const current = await regular(fileURLToPath(new URL(`../${path.slice(5)}`, import.meta.url)), MAX_FILE_BYTES);
            requiredHashes[path] = sha256(current);
            if (file.sha256 !== requiredHashes[path])
                supportsFamily = false;
        }
        if (before.operations.length > 0 && !supportsFamily)
            incompatible();
        // Refuse a moving state snapshot or a target/manifest replacement during verification.
        const after = await records.snapshot();
        if (after.digest !== stateDigest || sha256(await regular(input.manifest, 2 * 1024 * 1024)) !== input.manifestSha256 ||
            sha256(await regular(input.archive, MAX_FILE_BYTES)) !== manifest.archiveSha256)
            incompatible();
        return { proof_class: "verified_archive_recovery_selection", target_execution_performed: false,
            archive: input.archive, archive_sha256: manifest.archiveSha256, manifest_sha256: input.manifestSha256,
            package_root: input.packageRoot, source_commit: manifest.sourceCommit, files_verified: paths.size,
            supports_smart_account_gasless: supportsFamily, required_runtime_hashes: requiredHashes,
            state_digest: stateDigest, smart_account_operations: after.operations.length,
            guards_held: after.operations.filter(operation => !operation.terminal).length };
    }
    catch {
        return incompatible();
    }
}
class RecoveryJournalReader extends SmartAccountGaslessOperationRepository {
    async snapshot() {
        const operations = await this.listAllOperations(), receipts = "smart-account-gasless-receipts";
        const identities = new Set(operations.map(op => `${op.profileHash}/${op.operationId}.json`));
        for (const profile of await this.readDirectory(receipts)) {
            if (!profile.isDirectory() || profile.isSymbolicLink() || !digest(profile.name))
                incompatible();
            for (const file of await this.readDirectory(`${receipts}/${profile.name}`)) {
                if (!file.isFile() || file.isSymbolicLink() || !identities.has(`${profile.name}/${file.name}`))
                    incompatible();
            }
        }
        const bindings = [];
        for (const operation of operations) {
            const value = await this.readJson(`${receipts}/${operation.profileHash}/${operation.operationId}.json`);
            // Operation-first persistence may leave an absent sidecar or an authenticated earlier prefix.
            // Validate and bind that exact crash state without repairing it or blocking ordinary recovery.
            const receipt = value === null ? null : validateSmartAccountGaslessReceipt(value, operation);
            bindings.push([operation.operationId, operation.integrityHash, receipt?.receipt_hash ?? null]);
        }
        bindings.sort((a, b) => a[0].localeCompare(b[0]));
        return { operations, digest: sha256(canonicalJson(bindings)) };
    }
}
function parseManifest(value) {
    if (!isPlainRecord(value) || typeof value.archive !== "string" || !isAbsolute(value.archive) ||
        typeof value.packageRoot !== "string" || !isAbsolute(value.packageRoot) || !digest(value.archiveSha256) ||
        typeof value.sourceCommit !== "string" || !/^[a-f0-9]{40}$/u.test(value.sourceCommit) ||
        value.allArchiveFilesMatchGitSourceAndInstalledBytes !== true || !Number.isSafeInteger(value.fileCount) ||
        !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 8192 || value.fileCount !== value.files.length)
        incompatible();
    for (const file of value.files) {
        if (!isPlainRecord(file) || Object.keys(file).sort().join(",") !== "bytes,path,sha256" ||
            typeof file.path !== "string" || !/^[A-Za-z0-9_.@/-]+$/u.test(file.path) ||
            file.path.split("/").some(part => !part || part === "." || part === ".." || part === "node_modules") ||
            !digest(file.sha256) || !Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0 || Number(file.bytes) > MAX_FILE_BYTES)
            incompatible();
    }
    if (new Set(value.files.map(file => file.path)).size !== value.files.length)
        incompatible();
    return value;
}
function digest(value) { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
async function directory(path) {
    if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path)
        incompatible();
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink())
        incompatible();
}
async function regular(path, maximum) {
    if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path)
        incompatible();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
            incompatible();
        const bytes = await file.readFile(), after = await file.stat(), current = await lstat(path);
        if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
            current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev || await realpath(path) !== path)
            incompatible();
        return bytes;
    }
    finally {
        await file.close();
    }
}
async function inventory(root) {
    const result = [];
    async function visit(prefix) {
        for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
            if (prefix === "" && entry.name === "node_modules")
                continue; // Exact dependency closure belongs to independent archive verification.
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink())
                incompatible();
            if (entry.isDirectory())
                await visit(path);
            else if (entry.isFile())
                result.push(path);
            else
                incompatible();
            if (result.length > 8192)
                incompatible();
        }
    }
    await visit("");
    return result.sort();
}
if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    try {
        const args = process.argv.slice(2), options = {};
        for (let index = 0; index < args.length; index += 2) {
            const key = args[index], value = args[index + 1];
            if (key === undefined || value === undefined || options[key] !== undefined ||
                !["--state-root", "--archive", "--manifest", "--manifest-sha256", "--package-root"].includes(key))
                incompatible();
            options[key] = value;
        }
        if (Object.keys(options).length !== 5)
            incompatible();
        const result = await selectSmartAccountGaslessRecoveryArchive({ stateRoot: options["--state-root"], archive: options["--archive"],
            manifest: options["--manifest"], manifestSha256: options["--manifest-sha256"], packageRoot: options["--package-root"] });
        process.stdout.write(`${canonicalJson({ ok: true, ...result })}\n`);
    }
    catch {
        process.stdout.write(`${canonicalJson({ ok: false, error: { code: "APN_OPERATION_BLOCKED", reason: "sa_gasless_archive_incompatible" } })}\n`);
        process.exitCode = 1;
    }
}
//# sourceMappingURL=recovery-gate.js.map