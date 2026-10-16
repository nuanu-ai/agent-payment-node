import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ApnError } from "./errors.js";
/** Kinds that `apn operation status|resume` and `apn receipt get` resolve (OperationService.required). */
export const GENERIC_OPERATION_KINDS = [
    "direct_transfer", "rail_transfer", "x402_fetch", "bridge_route", "gasless_transfer", "metamask_gasless_transfer",
    "smart_account_gasless_transfer", "facilitator_gasless_transfer", "circle_route", "merchant_x402", "permit2_production",
    "relay_unsigned", "sei_gaszip", "mega_gaszip",
];
/** Kinds `apn operation abandon` can close with owner consent (operation-abandon-service.ts). */
export const ABANDON_OPERATION_KINDS = [
    "direct_transfer", "rail_transfer", "gasless_transfer", "metamask_gasless_transfer", "facilitator_gasless_transfer",
];
/** Families with their own journals that the generic operation commands do not read yet, by state-store directory prefix. */
const UNCOVERED_FAMILIES = [
    { prefixes: ["swap-", "uniswap-", "sunswap-", "jupiter-", "orca-"], family: "swap", commands: [
            "apn swap ethereum uniswap status", "apn swap ethereum uniswap-token status", "apn swap tron sunswap status",
            "apn swap solana jupiter status", "apn swap solana orca status", "apn swap solana orca stable-status"
        ] },
    { prefixes: ["stargate-v2-native"], family: "stargate_native", commands: ["apn stargate native status"] },
    { prefixes: ["stargate-v2-token"], family: "stargate_token", commands: ["apn stargate token status"] },
    { prefixes: ["gasless-usdt"], family: "gasless_usdt", commands: ["apn gasless usdt status"] },
    { prefixes: ["oneclick-source"], family: "oneclick_source", commands: ["apn oneclick source status"] },
    { prefixes: ["circle-approvals"], family: "circle_approval", commands: ["apn circle approval status"] },
];
const COMMANDS = new Set(["operation.status", "operation.resume", "operation.abandon", "receipt.get"]);
const OPERATION_ID = /^[a-f0-9]{64}$/u;
/**
 * Turns a bare "operation not found" from a generic operation command into an exact answer: either the operation
 * belongs to a family those commands do not cover yet (with that family's own commands), or it is unknown to every
 * store. Only names are listed (no record is parsed), so a damaged record of another family cannot change the answer.
 */
export async function explainOperationNotFound(root, request, error) {
    if (!(error instanceof ApnError) || error.code !== "APN_OPERATION_NOT_FOUND" || !COMMANDS.has(request.command))
        return error;
    const operationId = request.operationId;
    const covered = request.command === "operation.abandon" ? ABANDON_OPERATION_KINDS : GENERIC_OPERATION_KINDS;
    if (typeof operationId !== "string" || !OPERATION_ID.test(operationId))
        return error;
    for (const store of await storesNaming(root, operationId)) {
        const known = UNCOVERED_FAMILIES.find(item => item.prefixes.some(prefix => store.startsWith(prefix)));
        if (known === undefined)
            continue;
        return new ApnError("APN_UNSUPPORTED_COMMAND", `This ${known.family} operation exists, but the generic operation commands do not cover its family yet; use its own command.`, { reason: "operation_kind_not_covered", family: known.family, store, covered_kinds: covered, nextActions: known.commands });
    }
    return new ApnError("APN_OPERATION_NOT_FOUND", error.message, { covered_kinds: covered });
}
/** Top-level state stores holding an entry named for this operation id, at most three levels deep. */
async function storesNaming(root, operationId) {
    const stores = [];
    for (const top of await listing(root)) {
        if (top.isDirectory() && top.name !== "locks" && await names(join(root, top.name), operationId, 3))
            stores.push(top.name);
    }
    return stores;
}
async function names(directory, operationId, depth) {
    const entries = await listing(directory);
    if (entries.some(entry => entry.name === operationId || entry.name.startsWith(`${operationId}.`)))
        return true;
    if (depth <= 1)
        return false;
    for (const entry of entries)
        if (entry.isDirectory() && await names(join(directory, entry.name), operationId, depth - 1))
            return true;
    return false;
}
async function listing(directory) {
    try {
        return await readdir(directory, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=operation-coverage.js.map