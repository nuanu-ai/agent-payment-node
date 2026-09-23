import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { USDT_EXCHANGE_RATE_MAX, USDT_GASLESS, USDT_POST_OP_GAS_MAX } from "./model.js";
import { decodeUsdtPaymasterData, validateUsdtPaymasterData } from "./paymaster-data.js";
import { usdtApprovalTransferBatch } from "./policy-prepare.js";
import { planUsdtTransfer } from "./quote.js";
import { usdtUserOperation } from "./userop.js";
export const USDT_BOUND_OPERATION_SCHEMA = "apn.gasless-usdt-bound-operation.v1";
const HASH = /^[a-f0-9]{64}$/u;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_BYTES = 1024 * 1024;
const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c`;
const STUB_WORD = `0x${"11".repeat(32)}`;
const serializable = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
function fail(reason, code = "APN_STATE_CORRUPT") {
    throw new ApnError(code, `Gasless USDT binding refused: ${reason}.`, { reason, rail: "gasless_usdt" });
}
function freeze(value) {
    if (value !== null && typeof value === "object") {
        for (const nested of Object.values(value))
            freeze(nested);
        Object.freeze(value);
    }
    return value;
}
function decimal(value) {
    if (typeof value !== "string" || !DECIMAL.test(value))
        fail("binding_decimal");
    return BigInt(value);
}
function body(record) {
    const { integrityHash: _ignored, ...rest } = record;
    return rest;
}
/** Validate both hashes and the relationships that a rehashed but inconsistent record could violate. */
export function validateUsdtBoundOperation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profileHash", "idempotencyKey", "binding", "createdAt", "signerBoundary", "dispatch", "usageReservation", "integrityHash"]))
        fail("bound_shape");
    if (value.schemaVersion !== USDT_BOUND_OPERATION_SCHEMA || typeof value.operationId !== "string" || !HASH.test(value.operationId) ||
        typeof value.profileHash !== "string" || !HASH.test(value.profileHash) || typeof value.idempotencyKey !== "string" || !KEY.test(value.idempotencyKey) ||
        typeof value.integrityHash !== "string" || !HASH.test(value.integrityHash) || value.signerBoundary !== "unavailable" ||
        value.dispatch !== "disabled" || value.usageReservation !== "disabled")
        fail("bound_identity");
    if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
        new Date(value.createdAt).toISOString() !== value.createdAt)
        fail("bound_timestamp");
    const b = value.binding;
    if (!isPlainRecord(b) || !exactKeys(b, ["schemaVersion", "profile", "policyDigest", "policyRevision", "activationDigest", "chain", "token", "mechanism", "sponsorUrl", "safeBlockNumber", "safeBlockHash", "account", "plan", "callData", "paymaster", "paymasterData", "unsignedOperation", "bindingHash"]))
        fail("binding_shape");
    if (b.schemaVersion !== "apn.gasless-usdt-policy-prepare.v1" || typeof b.profile !== "string" || !b.profile ||
        typeof b.policyDigest !== "string" || !HASH.test(b.policyDigest) || typeof b.activationDigest !== "string" || !HASH.test(b.activationDigest) ||
        !Number.isSafeInteger(b.policyRevision) || b.policyRevision < 1 || b.chain !== USDT_GASLESS.chain || b.token !== USDT_GASLESS.token ||
        canonicalJson(b.mechanism) !== canonicalJson(USDT_GASLESS.mechanism) || b.sponsorUrl !== USDT_GASLESS.bundlerUrl ||
        decimal(b.safeBlockNumber) < 1n || typeof b.safeBlockHash !== "string" || !HEX32.test(b.safeBlockHash))
        fail("binding_policy_chain");
    if (!isPlainRecord(b.account) || !exactKeys(b.account, ["usdtBalanceAtomic", "entryPointNonce", "eoaNonce", "delegation"]) ||
        !["empty", "expected"].includes(b.account.delegation))
        fail("binding_account");
    const account = { usdtBalanceAtomic: decimal(b.account.usdtBalanceAtomic), entryPointNonce: decimal(b.account.entryPointNonce),
        eoaNonce: decimal(b.account.eoaNonce), delegation: b.account.delegation };
    if (!isPlainRecord(b.plan) || !isPlainRecord(b.plan.request) || !isPlainRecord(b.plan.quote) || !isPlainRecord(b.plan.price) || !isPlainRecord(b.plan.gas))
        fail("binding_plan");
    const p = b.plan, r = p.request, q = p.quote, gasPrice = p.price;
    const request = { sender: r.sender, recipient: r.recipient,
        grossAtomic: decimal(r.grossAtomic), maxFeeAtomic: decimal(r.maxFeeAtomic), minReceivedAtomic: decimal(r.minReceivedAtomic) };
    const quote = { paymaster: q.paymaster, token: q.token, postOpGas: decimal(q.postOpGas),
        exchangeRate: decimal(q.exchangeRate), exchangeRateNativeToUsd: decimal(q.exchangeRateNativeToUsd) };
    const price = { maxFeePerGas: decimal(gasPrice.maxFeePerGas), maxPriorityFeePerGas: decimal(gasPrice.maxPriorityFeePerGas) };
    try {
        if (getAddress(request.sender) !== request.sender || getAddress(request.recipient) !== request.recipient ||
            request.recipient === USDT_GASLESS.token || request.recipient === USDT_GASLESS.paymaster ||
            quote.paymaster !== USDT_GASLESS.paymaster || quote.token !== USDT_GASLESS.token ||
            quote.postOpGas === 0n || quote.postOpGas > USDT_POST_OP_GAS_MAX || quote.exchangeRate === 0n ||
            quote.exchangeRate > USDT_EXCHANGE_RATE_MAX || quote.exchangeRateNativeToUsd === 0n ||
            quote.exchangeRateNativeToUsd > USDT_EXCHANGE_RATE_MAX || price.maxFeePerGas === 0n ||
            price.maxPriorityFeePerGas > price.maxFeePerGas)
            fail("binding_route");
    }
    catch {
        fail("binding_route");
    }
    let planned;
    try {
        planned = planUsdtTransfer(request, quote, price);
    }
    catch {
        fail("binding_plan");
    }
    if (canonicalJson(serializable(planned)) !== canonicalJson(p) || account.usdtBalanceAtomic < request.grossAtomic ||
        typeof b.callData !== "string" || b.callData !== usdtApprovalTransferBatch(planned))
        fail("binding_plan");
    if (typeof b.paymasterData !== "string")
        fail("binding_paymaster");
    let paymaster;
    try {
        paymaster = validateUsdtPaymasterData({ paymaster: USDT_GASLESS.paymaster, paymasterData: b.paymasterData }, planned, BigInt(Math.floor(Date.parse(value.createdAt) / 1000)));
    }
    catch {
        fail("binding_paymaster");
    }
    if (paymaster.exchangeRate !== quote.exchangeRate || canonicalJson(serializable(paymaster)) !== canonicalJson(b.paymaster))
        fail("binding_paymaster");
    const op = b.unsignedOperation;
    if (!isPlainRecord(op) || op.sender !== request.sender || op.callData !== b.callData || op.paymasterData !== b.paymasterData ||
        op.paymaster !== USDT_GASLESS.paymaster || op.nonce !== `0x${account.entryPointNonce.toString(16)}`)
        fail("binding_operation");
    if (op.signature !== ESTIMATE_SIGNATURE || (account.delegation === "empty" &&
        (!isPlainRecord(op.eip7702Auth) || canonicalJson(op.eip7702Auth) !== canonicalJson({ chainId: "0x1",
            address: USDT_GASLESS.delegate, nonce: `0x${account.eoaNonce.toString(16)}`, yParity: "0x0", r: STUB_WORD, s: STUB_WORD }))))
        fail("binding_stub");
    const expected = usdtUserOperation(planned, { entryPointNonce: account.entryPointNonce, callData: b.callData,
        paymasterData: b.paymasterData, signature: op.signature,
        authorization: account.delegation === "empty" ? op.eip7702Auth : null });
    if (canonicalJson(expected) !== canonicalJson(op) || (account.delegation === "empty" &&
        (!isPlainRecord(op.eip7702Auth) || op.eip7702Auth.address !== USDT_GASLESS.delegate ||
            op.eip7702Auth.nonce !== `0x${account.eoaNonce.toString(16)}`)))
        fail("binding_operation");
    const { bindingHash: _hash, ...bindingBody } = b;
    if (typeof b.bindingHash !== "string" || b.bindingHash !== hashObject(bindingBody) ||
        value.operationId !== hashObject({ schemaVersion: USDT_BOUND_OPERATION_SCHEMA, profileHash: value.profileHash,
            idempotencyKey: value.idempotencyKey, bindingHash: b.bindingHash }) ||
        value.integrityHash !== hashObject(body(value)))
        fail("binding_integrity");
    return freeze(value);
}
/** Separate v2 journal keeps old dormant v1 records readable while requiring the complete new binding. */
export class UsdtBoundOperationRepository {
    root;
    directory;
    tail = Promise.resolve();
    constructor(root) {
        this.root = root;
        if (!isAbsolute(root) || normalize(root) !== root || resolve(root) !== root)
            fail("state_root", "APN_STATE_SECURITY");
        this.directory = join(root, "gasless-usdt-bound-operations");
    }
    path(profileHash, operationId) {
        if (!HASH.test(profileHash) || !HASH.test(operationId))
            fail("bound_path", "APN_STATE_SECURITY");
        return join(this.directory, profileHash, `${operationId}.json`);
    }
    async dir(path, create) {
        if (create)
            await mkdir(path, { recursive: true, mode: DIR_MODE });
        let stat;
        try {
            stat = await lstat(path);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return false;
            throw error;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== DIR_MODE)
            fail("bound_directory", "APN_STATE_SECURITY");
        return true;
    }
    async load(profileHash, operationId) {
        const path = this.path(profileHash, operationId);
        if (!await this.dir(this.root, false) || !await this.dir(this.directory, false) || !await this.dir(join(this.directory, profileHash), false))
            return null;
        let stat;
        try {
            stat = await lstat(path);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw error;
        }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== FILE_MODE || stat.size > MAX_BYTES)
            fail("bound_file", "APN_STATE_SECURITY");
        let parsed;
        try {
            parsed = JSON.parse(await readFile(path, "utf8"));
        }
        catch {
            fail("bound_json");
        }
        const record = validateUsdtBoundOperation(parsed);
        if (record.profileHash !== profileHash || record.operationId !== operationId)
            fail("bound_path_binding");
        return record;
    }
    async create(profileHash, binding, idempotencyKey, now) {
        if (!HASH.test(profileHash) || !KEY.test(idempotencyKey) || !Number.isFinite(now.getTime()))
            fail("bound_input", "APN_INVALID_INPUT");
        const saved = serializable(binding);
        const operationId = hashObject({ schemaVersion: USDT_BOUND_OPERATION_SCHEMA, profileHash, idempotencyKey, bindingHash: saved.bindingHash });
        const draft = { schemaVersion: USDT_BOUND_OPERATION_SCHEMA, operationId, profileHash, idempotencyKey, binding: saved,
            createdAt: now.toISOString(), signerBoundary: "unavailable", dispatch: "disabled", usageReservation: "disabled" };
        const record = validateUsdtBoundOperation({ ...draft, integrityHash: hashObject(draft) });
        const previous = this.tail;
        let release;
        this.tail = new Promise(done => { release = done; });
        await previous;
        try {
            await this.dir(this.root, true);
            await this.dir(this.directory, true);
            await this.dir(join(this.directory, profileHash), true);
            for (const entry of await readdir(join(this.directory, profileHash), { withFileTypes: true })) {
                if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                    fail("bound_inventory");
                const existing = await this.load(profileHash, entry.name.slice(0, -5));
                if (existing?.idempotencyKey === idempotencyKey && existing.operationId !== operationId)
                    fail("bound_idempotency", "APN_IDEMPOTENCY_CONFLICT");
            }
            const path = this.path(profileHash, operationId);
            try {
                await writeFile(path, `${canonicalJson(record)}\n`, { flag: "wx", mode: FILE_MODE });
            }
            catch (error) {
                if (error.code !== "EEXIST")
                    throw error;
            }
            const found = await this.load(profileHash, operationId);
            if (found === null)
                fail("bound_missing");
            if (canonicalJson(found) !== canonicalJson(record))
                fail("bound_conflict", "APN_IDEMPOTENCY_CONFLICT");
            return found;
        }
        finally {
            release();
        }
    }
}
/** Classification reads only. Drift or revocation never advances the operation or authorizes an effect. */
export async function classifyUsdtBoundRecovery(operation, port) {
    const b = operation.binding;
    try {
        const now = port.now();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
            return { state: "recovery_required", reason: "clock_unavailable", operation };
        if (BigInt(Math.floor(now.getTime() / 1000)) >= decodeUsdtPaymasterData(b.paymasterData).validUntil) {
            return { state: "capability_unavailable", reason: "paymaster_expired", operation };
        }
        const active = await port.activePolicy(b.profile);
        if (active === null || active.digest !== active.registry.policyDigest || active.digest !== b.policyDigest || active.revision !== b.policyRevision ||
            active.activationDigest !== b.activationDigest || active.accounts.evm !== b.plan.request.sender) {
            return { state: "capability_unavailable", reason: "policy_revoked_or_changed", operation };
        }
        const usage = await port.dailyUsage(b.plan.request.sender, now);
        const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token },
            rail: "gasless", amountAtomic: b.plan.request.grossAtomic.toString(), dailyUsageAtomic: usage,
            asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        if (admission.asset.mechanismPins?.gasless === undefined ||
            canonicalJson(admission.asset.mechanismPins.gasless) !== canonicalJson(USDT_GASLESS.mechanism)) {
            return { state: "capability_unavailable", reason: "policy_mechanism_changed", operation };
        }
        const snapshot = await port.safeSnapshot(b.plan.request.sender);
        if (snapshot.chainId !== 1n || snapshot.blockNumber < BigInt(b.safeBlockNumber) ||
            snapshot.account.entryPointNonce !== BigInt(b.account.entryPointNonce) ||
            snapshot.account.eoaNonce !== BigInt(b.account.eoaNonce) || snapshot.account.delegation !== b.account.delegation ||
            snapshot.account.usdtBalanceAtomic < BigInt(b.plan.request.grossAtomic)) {
            return { state: "capability_unavailable", reason: "chain_state_drift", operation };
        }
        if (snapshot.blockNumber !== BigInt(b.safeBlockNumber) || snapshot.blockHash !== b.safeBlockHash) {
            return { state: "recovery_required", reason: "safe_block_changed", operation };
        }
        return { state: "prepared", operation };
    }
    catch (error) {
        if (error instanceof ApnError && error.code === "APN_ALLOWLIST_REFUSED")
            return { state: "capability_unavailable", reason: "policy_revoked_or_changed", operation };
        return { state: "recovery_required", reason: "read_unavailable", operation };
    }
}
//# sourceMappingURL=bound-operation.js.map