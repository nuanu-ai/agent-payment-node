import { isPlainRecord } from "./canonical.js";
import { parseCatalogArgv, parseCatalogInput, } from "./command-catalog.js";
import { ApnError } from "./errors.js";
export function bindArgv(argv) {
    return bindParsedCatalog(parseCatalogArgv(argv));
}
export function bindMcpInput(command, input) {
    if (!isPlainRecord(input)) {
        throw new ApnError("APN_INVALID_INPUT", "Tool input must be an object.");
    }
    const byField = new Map();
    for (const option of command.options) {
        const field = mcpFieldName(option.name);
        if (byField.has(field))
            throw new ApnError("APN_INTERNAL", "Command options collide after MCP projection.");
        byField.set(field, option);
    }
    const catalogInput = {};
    for (const [field, value] of Object.entries(input)) {
        const option = byField.get(field);
        if (option === undefined)
            throw new ApnError("APN_INVALID_INPUT", "Tool input contains an unknown field.");
        catalogInput[option.name] = value;
    }
    return bindParsedCatalog(parseCatalogInput(command, catalogInput));
}
export function mcpFieldName(optionName) {
    const field = optionName.slice(2).replaceAll("-", "_");
    if (!/^[a-z][a-z0-9_]*$/u.test(field)) {
        throw new ApnError("APN_INTERNAL", "Command option cannot be projected to a safe MCP field.");
    }
    return field;
}
function bindParsedCatalog(parsed) {
    const options = parsed.values;
    switch (parsed.command.path.join(" ")) {
        case "--version": return { request: { command: "version" } };
        case "doctor keychain": return { request: { command: "doctor.keychain" } };
        case "wallet ensure": return { request: { command: "wallet.ensure", profile: value(options, "--profile") } };
        case "wallet connect": return {
            request: {
                command: "wallet.connect",
                profile: value(options, "--profile"),
                providerId: value(options, "--provider"),
                ...(options["--expected-revision"] === undefined
                    ? {}
                    : { expectedRevision: Number(options["--expected-revision"]) }),
            },
        };
        case "wallet status": return { request: { command: "wallet.status", profile: value(options, "--profile") } };
        case "wallet balance": return {
            request: { command: "wallet.balance", profile: value(options, "--profile") },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "wallet policy show": return { request: { command: "wallet.policy.show", profile: value(options, "--profile") } };
        case "wallet policy set": return {
            request: {
                command: "wallet.policy.set",
                profile: value(options, "--profile"),
                maxBalanceUsdcAtomic: value(options, "--max-balance-usdc-atomic"),
                maxX402AmountAtomic: value(options, "--max-x402-amount-atomic"),
                ...(options["--max-balance-eth-wei"] === undefined ? {} : { maxBalanceEthWei: options["--max-balance-eth-wei"] }),
            },
        };
        case "x402 inspect": return { request: { command: "x402.inspect", url: value(options, "--url") } };
        case "x402 fetch prepare": return {
            request: {
                command: "x402.fetch.prepare",
                profile: value(options, "--profile"),
                url: value(options, "--url"),
                ...(options["--max-amount-atomic"] === undefined ? {} : { maxAmountAtomic: options["--max-amount-atomic"] }),
                idempotencyKey: value(options, "--idempotency-key"),
            },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "x402 fetch approve": return {
            request: { command: "x402.fetch.approve", operationId: value(options, "--operation") },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "pay transfer prepare": return {
            request: {
                command: "transfer.prepare",
                profile: value(options, "--profile"),
                idempotencyKey: value(options, "--idempotency-key"),
                recipient: value(options, "--to"),
                amount: value(options, "--amount-usdc"),
            },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "pay transfer approve": return {
            request: { command: "transfer.approve", operationId: value(options, "--operation") },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "operation status": return { request: { command: "operation.status", operationId: value(options, "--operation") } };
        case "operation resume": return {
            request: {
                command: "operation.resume",
                operationId: value(options, "--operation"),
                ...(options["--wait-seconds"] === undefined ? {} : { waitSeconds: Number(options["--wait-seconds"]) }),
            },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "operation recover-transaction-settlement": return {
            request: {
                command: "operation.recover-transaction-settlement",
                operationId: value(options, "--operation"),
                transactionHash: value(options, "--transaction-hash"),
                idempotencyKey: value(options, "--idempotency-key"),
            },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "receipt get": return { request: { command: "receipt.get", operationId: value(options, "--operation") } };
        default: throw new ApnError("APN_INTERNAL", "The command catalog has no request binding.");
    }
}
function value(options, name) {
    const selected = options[name];
    if (selected === undefined)
        throw new ApnError("APN_INTERNAL", "The command catalog omitted a required request binding.");
    return selected;
}
//# sourceMappingURL=command-binder.js.map