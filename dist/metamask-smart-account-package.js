import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
export const METAMASK_SMART_ACCOUNTS_KIT_VERSION = "2.0.0";
export const METAMASK_SMART_ACCOUNTS_KIT_INTEGRITY = "sha512-eye6GMdOyhL9SPaWwwE0Zlk1466JFxQqB5NH5lHaTo8htibFZmjnKctbKzhdW+FOx53R767BRZXQx7bq6/KACA==";
export const METAMASK_SMART_ACCOUNTS_KIT_SHASUM = "0293e1745851c63f0f044772fc04de8954c0d627";
export const METAMASK_PERMISSION_TYPES_VERSION = "2.0.0";
export const METAMASK_PERMISSION_TYPES_INTEGRITY = "sha512-NS6NolXd7fDQhMZoEmzyQcLuJ9NtIPntKOAEOMdFQuR8y1HWpN6PYx1BrY6OgHmJ1D/P4vuWlCooDlh+L8CmVw==";
export const METAMASK_PERMISSION_TYPES_SHASUM = "3eee5b343e1382aed62feaf7d703fb826742fbe7";
export const METAMASK_X402_VERSION = "1.0.0";
export const METAMASK_X402_INTEGRITY = "sha512-jgQ7iCBKPE+k3dPCgEIBKrt1xFLfwyaXVBIa9dxuN5dkXTkQs9X9gmY4V/7wRqN32WoeV4qhEj/L/6qcHw+i9g==";
export const X402_EVM_VERSION = "2.23.0";
export const X402_EVM_INTEGRITY = "sha512-Ikaya5c0/qV/pdFRGfGSdlUX3ELZaUgrddsmmXZHPANtIAQ5uFH15+O+9Bt4PqdAXqCuS43WskJ7HgiLn/uW2g==";
export async function assertMetaMaskSmartAccountPackageIdentity() {
    await Promise.all([
        assertManifest("@metamask/smart-accounts-kit", METAMASK_SMART_ACCOUNTS_KIT_VERSION, true),
        assertManifest("@metamask/7715-permission-types", METAMASK_PERMISSION_TYPES_VERSION, false),
        assertManifest("@metamask/x402", METAMASK_X402_VERSION, false),
        assertX402EvmManifest(),
    ]);
}
async function assertX402EvmManifest() {
    const require = createRequire(import.meta.url);
    let value;
    try {
        let directory = dirname(require.resolve("@x402/evm"));
        for (let depth = 0; depth < 5; depth += 1) {
            try {
                const candidate = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
                if (isPlainRecord(candidate) && candidate.name === "@x402/evm") {
                    value = candidate;
                    break;
                }
            }
            catch { /* keep walking to the package root */ }
            const parent = dirname(directory);
            if (parent === directory)
                break;
            directory = parent;
        }
    }
    catch {
        throw unavailable("The exact @x402/evm package is not installed.");
    }
    if (value === undefined)
        throw unavailable("The exact @x402/evm package manifest is unavailable.");
    const repository = isPlainRecord(value) && typeof value.repository === "string" ? value.repository : undefined;
    const rootExport = isPlainRecord(value) && isPlainRecord(value.exports) ? value.exports["."] : undefined;
    if (!isPlainRecord(value) || value.name !== "@x402/evm" || value.version !== X402_EVM_VERSION ||
        value.license !== "Apache-2.0" || repository !== "https://github.com/x402-foundation/x402" ||
        !isPlainRecord(rootExport))
        throw protocol();
}
async function assertManifest(name, version, kit) {
    const require = createRequire(import.meta.url);
    let manifestPath;
    try {
        manifestPath = require.resolve(`${name}/package.json`);
    }
    catch {
        throw unavailable(`The exact ${name} package is not installed.`);
    }
    let value;
    try {
        value = JSON.parse(await readFile(manifestPath, "utf8"));
    }
    catch {
        throw unavailable(`The ${name} manifest is unavailable.`);
    }
    const rootExport = isPlainRecord(value) && isPlainRecord(value.exports) ? value.exports["."] : undefined;
    const actionsExport = isPlainRecord(value) && isPlainRecord(value.exports) ? value.exports["./actions"] : undefined;
    const utilsExport = isPlainRecord(value) && isPlainRecord(value.exports) ? value.exports["./utils"] : undefined;
    const repository = isPlainRecord(value) && isPlainRecord(value.repository) ? value.repository.url : undefined;
    if (!isPlainRecord(value) || value.name !== name || value.version !== version ||
        value.license !== "(MIT-0 OR Apache-2.0)" ||
        typeof repository !== "string" || repository !== "https://github.com/MetaMask/smart-accounts-kit.git" ||
        !isPlainRecord(rootExport) || (kit && (!isPlainRecord(actionsExport) || !isPlainRecord(utilsExport))))
        throw protocol();
}
function unavailable(message) {
    return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: false });
}
function protocol() {
    return new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask Smart Account package identity is unsupported.", { retryable: false });
}
//# sourceMappingURL=metamask-smart-account-package.js.map