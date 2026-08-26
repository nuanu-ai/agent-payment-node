import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { ApnCore } from "./core.js";
import { HOST_SERIALIZED_ENV, OUTPUT_VERSION } from "./constants.js";
import { ApnError, asApnError } from "./errors.js";
import { InheritedNativeIpc } from "./native-ipc.js";
import { HttpsBaseRpc } from "./rpc.js";
import { StateStore } from "./state.js";
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
export async function runCli(argv, environment = process.env) {
    try {
        const parsed = parseArgv(argv);
        const native = needsNative(parsed.request) ? InheritedNativeIpc.fromEnvironment(environment) : undefined;
        const rpc = parsed.rpcUrl === undefined ? undefined : new HttpsBaseRpc(parsed.rpcUrl);
        const stateRoot = effectiveStateRoot();
        return await new ApnCore({
            state: new StateStore(stateRoot, { hostSerialized: environment[HOST_SERIALIZED_ENV] === "1" }),
            ...(native === undefined ? {} : { native }),
            ...(rpc === undefined ? {} : { rpc }),
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
    return resolve(userInfo().homedir, "Library", "Application Support", "nuanu-apn");
}
function needsNative(request) {
    return ["doctor.keychain", "wallet.ensure", "wallet.status", "transfer.approve", "operation.resume"].includes(request.command);
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