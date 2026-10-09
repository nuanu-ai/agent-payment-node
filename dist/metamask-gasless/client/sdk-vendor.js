import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../../../vendor/metamask-evm-sdk/", import.meta.url);
const MANIFEST_SHA256 = "5b6e8667e4a0adb277c1c6803d87168eb7b9cd72f0ba9fc3d349ec8162fdfd25";
const MAX_BYTES = 12 * 1024 * 1024;
const entries = new Set(["sdk-root", "sdk-base", "sdk-evm", "fox-evm", "fox-keyring", "controller"]);
let verified = false;
function reject() { throw new Error("APN EVM SDK vendor integrity rejected"); }
function read(name, maximum) {
    const path = fileURLToPath(new URL(name, root)), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
        reject();
    return readFileSync(path);
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function verify() {
    if (verified)
        return;
    const stat = lstatSync(fileURLToPath(root).replace(/\/$/u, ""));
    if (!stat.isDirectory() || stat.isSymbolicLink())
        reject();
    const bytes = read("manifest.json", 65536);
    if (digest(bytes) !== MANIFEST_SHA256)
        reject();
    const manifest = JSON.parse(bytes.toString("utf8"));
    let total = 0;
    for (const [name, expected] of Object.entries(manifest.files)) {
        if (!/^[A-Za-z0-9_-]+\.mjs(?:\.LEGAL\.txt)?$/u.test(name))
            reject();
        total += expected.bytes;
        if (total > MAX_BYTES)
            reject();
        const content = read(name, expected.bytes);
        if (content.length !== expected.bytes || digest(content) !== expected.sha256)
            reject();
    }
    verified = true;
}
async function load(name) {
    if (!entries.has(name))
        reject();
    verify();
    return await import(new URL(`${name}.mjs`, root).href);
}
export const agentSdk = () => load("sdk-root");
export const agentBase = () => load("sdk-base");
export const agentEvm = () => load("sdk-evm");
export const foxEvm = () => load("fox-evm");
export const foxKeyring = () => load("fox-keyring");
export const ethereumControllers = () => load("controller");
//# sourceMappingURL=sdk-vendor.js.map