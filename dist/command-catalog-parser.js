import { usageFailureEnvelope } from "./command-discovery-output.js";
import { COMMAND_GROUPS, COMMAND_MANIFEST, COMMANDS, } from "./command-catalog.js";
import { renderHelp } from "./command-help.js";
import { containsRawControlCharacters } from "./cli-handoff.js";
import { ApnError, asApnError } from "./errors.js";
export function parseCatalogArgv(argv) {
    const definition = longestCommandPrefix(argv);
    if (definition === undefined)
        throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported APN command.");
    const values = {};
    const tail = argv.slice(definition.path.length);
    for (let index = 0; index < tail.length; index += 2) {
        const token = tail[index];
        const value = tail[index + 1];
        if (token === undefined || value === undefined || !token.startsWith("--") || value.startsWith("--")) {
            throw new ApnError("APN_INVALID_INPUT", "Options must use complete `--name value` pairs.");
        }
        if (token in values)
            throw new ApnError("APN_INVALID_INPUT", "Command contains an unknown or duplicate option.");
        values[token] = value;
    }
    return parseCatalogInput(definition, values);
}
export function parseCatalogInput(definition, input) {
    const values = {};
    for (const [name, rawValue] of Object.entries(input)) {
        const optionDefinition = definition.options.find((candidate) => candidate.name === name);
        if (optionDefinition === undefined)
            throw new ApnError("APN_INVALID_INPUT", "Command contains an unknown or duplicate option.");
        if (typeof rawValue !== "string")
            throw new ApnError("APN_INVALID_INPUT", `${optionDefinition.name} must be a string.`);
        validateOptionValue(optionDefinition, rawValue);
        values[name] = rawValue;
    }
    for (const optionDefinition of definition.options) {
        if (values[optionDefinition.name] !== undefined)
            continue;
        if (optionDefinition.required)
            throw new ApnError("APN_INVALID_INPUT", `Missing required ${optionDefinition.name} option.`);
        if (optionDefinition.default.kind === "literal")
            values[optionDefinition.name] = optionDefinition.default.value;
    }
    validateCrossOptionConstraints(definition, values);
    return { command: definition, values };
}
export function dispatchDiscovery(argv) {
    const hasDiscoveryToken = argv.includes("--help") || argv.includes("--json") || argv[0] === "help";
    if (!hasDiscoveryToken)
        return null;
    try {
        if (samePath(argv, ["--help"]) || samePath(argv, ["help"])) {
            return { ok: true, output: renderHelp([]), exitCode: 0, presentation: "text" };
        }
        if (samePath(argv, ["help", "--json"])) {
            return { ok: true, output: JSON.stringify(COMMAND_MANIFEST), exitCode: 0, presentation: "json" };
        }
        if (argv[0] === "help") {
            const path = argv.slice(1);
            if (path.length === 0 || path.includes("--help") || path.includes("--json"))
                invalidDiscovery();
            return { ok: true, output: renderHelp(path), exitCode: 0, presentation: "text" };
        }
        if (argv.at(-1) === "--help") {
            const path = argv.slice(0, -1);
            if (path.length === 0 || path.includes("--help") || path.includes("--json"))
                invalidDiscovery();
            return { ok: true, output: renderHelp(path), exitCode: 0, presentation: "text" };
        }
        invalidDiscovery();
    }
    catch (error) {
        const safe = asApnError(error);
        return {
            ok: false,
            error: { code: safe.code, message: safe.message },
            nextActions: catalogNextActions(argv),
            exitCode: 1,
            presentation: "json",
        };
    }
}
export function renderDiscoveryOutput(dispatch) {
    if (dispatch.ok)
        return dispatch.output;
    return JSON.stringify(usageFailureEnvelope(dispatch.error, dispatch.nextActions));
}
export function catalogNextActions(argv) {
    const candidate = argv[0] === "help" ? argv.slice(1) : argv.at(-1) === "--help" ? argv.slice(0, -1) : argv;
    const prefix = longestCatalogPrefix(candidate);
    return prefix === undefined ? ["apn help"] : [`apn help ${prefix.path.join(" ")}`, "apn help"];
}
function longestCommandPrefix(argv) {
    return COMMANDS.reduce((selected, candidate) => {
        if (!hasPrefix(argv, candidate.path))
            return selected;
        return selected === undefined || candidate.path.length > selected.path.length ? candidate : selected;
    }, undefined);
}
function longestCatalogPrefix(argv) {
    const entries = [...COMMAND_GROUPS, ...COMMANDS];
    return entries.reduce((selected, candidate) => {
        if (!hasPrefix(argv, candidate.path))
            return selected;
        return selected === undefined || candidate.path.length > selected.path.length ? candidate : selected;
    }, undefined);
}
function validateOptionValue(definition, value) {
    const invalid = () => { throw new ApnError("APN_INVALID_INPUT", `${definition.name} does not satisfy its declared ${definition.type} contract.`); };
    if (containsRawControlCharacters(value))
        invalid();
    switch (definition.type) {
        case "string":
            if (value.length === 0)
                invalid();
            return;
        case "profile":
            if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value))
                invalid();
            return;
        case "provider_id":
            if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value))
                invalid();
            return;
        case "provider_auth_method":
            if (!/^[a-z][a-z0-9-]{0,31}$/u.test(value))
                invalid();
            return;
        case "positive_integer":
            if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)))
                invalid();
            return;
        case "https_url": {
            const parsed = (() => { try {
                return new URL(value);
            }
            catch {
                return invalid();
            } })();
            const constraints = new Set(definition.constraints);
            if (constraints.has("credential_free_https_without_fragment") &&
                (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== ""))
                invalid();
            const canonical = parsed.toString();
            if (constraints.has("maximum_2048_utf8_bytes") && Buffer.byteLength(canonical, "utf8") > 2048)
                invalid();
            if (constraints.has("canonical_whatwg_serialization") && canonical !== value)
                invalid();
            return;
        }
        case "address":
            if (!/^0x[0-9a-fA-F]{40}$/u.test(value))
                invalid();
            return;
        case "decimal_usdc": {
            const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]*[1-9]))?$/u.exec(value);
            if (match === null || (match[1]?.length ?? 0) > 6 || value === "0")
                invalid();
            return;
        }
        case "atomic_usdc":
        case "wei":
            if (!/^[1-9][0-9]*$/u.test(value))
                invalid();
            return;
        case "operation_id":
            if (!/^[a-f0-9]{64}$/u.test(value))
                invalid();
            return;
        case "transaction_hash":
            if (!/^0x[0-9a-fA-F]{64}$/u.test(value))
                invalid();
            return;
        case "provider_request_id":
            if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(value))
                invalid();
            return;
        case "idempotency_key":
            if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(value))
                invalid();
            return;
        case "integer_seconds":
            if (!/^[1-9][0-9]*$/u.test(value) || Number(value) > 300)
                invalid();
            return;
    }
}
function validateCrossOptionConstraints(definition, values) {
    for (const optionDefinition of definition.options) {
        if (!optionDefinition.constraints.includes("not_greater_than_max_balance_usdc_atomic"))
            continue;
        const selected = values[optionDefinition.name];
        const maximum = values["--max-balance-usdc-atomic"];
        if (selected === undefined || maximum === undefined || !/^[1-9][0-9]*$/u.test(selected) || !/^[1-9][0-9]*$/u.test(maximum)) {
            throw new ApnError("APN_INTERNAL", "The command catalog has an invalid cross-option constraint binding.");
        }
        if (BigInt(selected) > BigInt(maximum)) {
            throw new ApnError("APN_INVALID_INPUT", `${optionDefinition.name} does not satisfy its declared ${optionDefinition.type} contract.`);
        }
    }
}
function invalidDiscovery() {
    throw new ApnError("APN_INVALID_INPUT", "Discovery options are misplaced, duplicated, incomplete or unknown.");
}
function hasPrefix(value, prefix) {
    return prefix.length <= value.length && prefix.every((token, index) => value[index] === token);
}
function samePath(left, right) {
    return left.length === right.length && left.every((token, index) => right[index] === token);
}
//# sourceMappingURL=command-catalog-parser.js.map