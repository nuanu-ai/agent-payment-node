import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { ApnCore } from "./core.js";
import { OUTPUT_VERSION } from "./constants.js";
import { ApnError, asApnError } from "./errors.js";
import { LocalWalletNative } from "./local-wallet-native.js";
import { MacOSLoginKeychainSecret } from "./macos-keychain.js";
import { HttpsBaseRpc } from "./rpc.js";
import { StateStore } from "./state.js";
import { HttpsX402Http } from "./x402-http.js";
export function parseArgv(argv) {
    const [first, second, third, ...rest] = argv;
    if (first === "--version")
        return noArguments([second, third, ...rest].filter(defined), { command: "version" });
    if (first === "doctor" && second === "keychain")
        return noArguments([third, ...rest].filter(defined), { command: "doctor.keychain" });
    if (first === "wallet" && (second === "ensure" || second === "status")) {
        const options = parseOptions([third, ...rest].filter(defined), ["profile"]);
        return { request: { command: `wallet.${second}`, profile: options.profile ?? "default" } };
    }
    if (first === "wallet" && second === "balance") {
        const options = parseOptions([third, ...rest].filter(defined), ["profile", "rpc-url"]);
        return { request: { command: "wallet.balance", profile: options.profile ?? "default" }, rpcUrl: required(options, "rpc-url") };
    }
    if (first === "x402" && second === "inspect") {
        const options = parseOptions([third, ...rest].filter(defined), ["url"]);
        return { request: { command: "x402.inspect", url: required(options, "url") } };
    }
    if (first === "x402" && second === "fetch" && third === "prepare") {
        const options = parseOptions(rest, ["profile", "url", "max-amount-atomic", "idempotency-key", "rpc-url"]);
        return {
            request: {
                command: "x402.fetch.prepare",
                profile: required(options, "profile"),
                url: required(options, "url"),
                maxAmountAtomic: required(options, "max-amount-atomic"),
                idempotencyKey: required(options, "idempotency-key"),
            },
            rpcUrl: required(options, "rpc-url"),
        };
    }
    if (first === "x402" && second === "fetch" && third === "approve") {
        const options = parseOptions(rest, ["operation", "rpc-url"]);
        return {
            request: { command: "x402.fetch.approve", operationId: required(options, "operation") },
            rpcUrl: required(options, "rpc-url"),
        };
    }
    if (first === "pay" && second === "transfer" && third === "prepare") {
        const options = parseOptions(rest, ["profile", "idempotency-key", "to", "amount-usdc", "rpc-url"]);
        return {
            request: {
                command: "transfer.prepare",
                profile: required(options, "profile"),
                idempotencyKey: required(options, "idempotency-key"),
                recipient: required(options, "to"),
                amount: required(options, "amount-usdc"),
            },
            rpcUrl: required(options, "rpc-url"),
        };
    }
    if (first === "pay" && second === "transfer" && third === "approve") {
        const options = parseOptions(rest, ["operation", "rpc-url"]);
        return { request: { command: "transfer.approve", operationId: required(options, "operation") }, rpcUrl: required(options, "rpc-url") };
    }
    if (first === "operation" && (second === "status" || second === "resume")) {
        const options = parseOptions([third, ...rest].filter(defined), second === "resume" ? ["operation", "rpc-url"] : ["operation"]);
        return {
            request: { command: second === "resume" ? "operation.resume" : "operation.status", operationId: required(options, "operation") },
            ...(second === "resume" ? { rpcUrl: required(options, "rpc-url") } : {}),
        };
    }
    if (first === "receipt" && second === "get") {
        const options = parseOptions([third, ...rest].filter(defined), ["operation"]);
        return { request: { command: "receipt.get", operationId: required(options, "operation") } };
    }
    throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported APN command.");
}
export async function runCli(argv, _environment = process.env, options = {}) {
    try {
        const parsed = parseArgv(argv);
        const stateRoot = options.stateRoot ?? effectiveStateRoot();
        const state = new StateStore(stateRoot);
        const native = needsNative(parsed.request)
            ? options.native ?? new LocalWalletNative(state, options.wrappingSecret ?? new MacOSLoginKeychainSecret(), options.approval)
            : undefined;
        const rpc = parsed.rpcUrl === undefined ? undefined : new HttpsBaseRpc(parsed.rpcUrl);
        const http = ["x402.inspect", "x402.fetch.prepare", "operation.resume"].includes(parsed.request.command)
            ? new HttpsX402Http()
            : undefined;
        return await new ApnCore({
            state,
            ...(native === undefined ? {} : { native }),
            ...(rpc === undefined ? {} : { rpc }),
            ...(http === undefined ? {} : { http }),
        }).execute(parsed.request);
    }
    catch (error) {
        const safe = asApnError(error);
        return {
            version: OUTPUT_VERSION,
            request_id: randomUUID(),
            command: "invalid",
            ok: false,
            proof_class: "classified_failure",
            data: null,
            operation: null,
            receipt: null,
            error: { code: safe.code, message: safe.message, ...(safe.details === undefined ? {} : { details: safe.details }) },
            next_actions: [],
        };
    }
}
export function effectiveStateRoot() {
    return resolve(userInfo().homedir, ".apn");
}
function needsNative(request) {
    return [
        "doctor.keychain", "wallet.ensure", "wallet.status", "transfer.approve", "x402.fetch.approve", "operation.resume",
    ].includes(request.command);
}
function noArguments(rest, request) {
    if (rest.length !== 0)
        throw new ApnError("APN_INVALID_INPUT", "This command accepts no arguments.");
    return { request };
}
function parseOptions(argv, allowed) {
    const result = {};
    for (let index = 0; index < argv.length; index += 2) {
        const option = argv[index];
        const value = argv[index + 1];
        if (option === undefined || value === undefined || !option.startsWith("--"))
            throw new ApnError("APN_INVALID_INPUT", "Options must use `--name value` pairs.");
        const name = option.slice(2);
        if (!allowed.includes(name) || name in result || value.startsWith("--"))
            throw new ApnError("APN_INVALID_INPUT", "Command contains an unknown, duplicate, or missing option.");
        result[name] = value;
    }
    return result;
}
function required(options, name) {
    const value = options[name];
    if (value === undefined)
        throw new ApnError("APN_INVALID_INPUT", `Missing required --${name} option.`);
    return value;
}
function defined(value) { return value !== undefined; }
//# sourceMappingURL=cli.js.map