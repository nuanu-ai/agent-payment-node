import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
export const AWAL_VERSION = "2.12.1";
export const AWAL_BIN = "dist/index.js";
export const AWAL_INTEGRITY = "sha512-z4whchSMbUhDuhwoI/+7vZ1ArwG9e8C9yIX9Y3W+JXJkR3E95iIZ1vIBZ6nPWSzakCw21YuZhFvOpGKEXtN6kQ==";
export const AWAL_SHASUM = "9c4c077983d608e278ed84053199427026ebbaa8";
export const AWAL_PROCESS_TIMEOUT_MS = 30_000;
export async function resolveAwalBin() {
    const require = createRequire(import.meta.url);
    let manifestPath;
    try {
        manifestPath = require.resolve("awal/package.json");
    }
    catch {
        throw providerFailure("The exact wallet provider client is not installed.");
    }
    let value;
    try {
        value = JSON.parse(await readFile(manifestPath, "utf8"));
    }
    catch {
        throw providerFailure("The wallet provider client manifest is unavailable.");
    }
    if (!isPlainRecord(value))
        throw providerProtocol();
    const bin = typeof value.bin === "string"
        ? value.bin
        : isPlainRecord(value.bin) && typeof value.bin.awal === "string" ? value.bin.awal : undefined;
    const repository = isPlainRecord(value.repository) ? value.repository.url : undefined;
    if (value.name !== "awal" || value.version !== AWAL_VERSION || bin !== AWAL_BIN || value.license !== "Apache-2.0" ||
        !isPlainRecord(value.engines) || value.engines.node !== ">=18" ||
        typeof repository !== "string" || !repository.includes("github.com/coinbase/awal"))
        throw providerProtocol();
    const script = resolve(dirname(manifestPath), bin);
    if (!script.startsWith(`${dirname(manifestPath)}/`))
        throw providerProtocol();
    return script;
}
function providerProtocol() {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "The wallet provider returned an unsupported safe response.", { retryable: false });
}
function providerFailure(message) {
    return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: true });
}
//# sourceMappingURL=awal-package.js.map