import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decodeAbiParameters, decodeEventLog, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, pad, zeroAddress, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import { canonicalProfile } from "../wallet-policy.js";
import { STARGATE_QUOTE_ABI, STARGATE_QUOTE_SEND_OUTPUT, STARGATE_SEND_ABI } from "./abi.js";
import { quoteStargateV2Direct } from "./quote.js";
const SOURCE_CHAIN = 1;
const DESTINATION_CHAIN = 130;
const SOURCE_EID = 30101;
const DESTINATION_EID = 30320;
const SOURCE_POOL = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
const DESTINATION_POOL = getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7");
const UINT = /^(?:0|[1-9][0-9]{0,77})$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const CODE = /^0x(?:[0-9a-f]{2})+$/u;
const MAX_TTL_MS = 120_000;
function fail(code, reason) {
    throw new ApnError(code, `Direct Stargate V2 native execution failed closed: ${reason}.`, { reason });
}
function uint(value, positive = false) {
    if (typeof value !== "string" || !UINT.test(value))
        return fail("APN_INVALID_INPUT", "noncanonical_uint");
    const n = BigInt(value);
    if (n >= 1n << 256n || (positive && n === 0n))
        return fail("APN_INVALID_INPUT", "uint_range");
    return n;
}
function address(value) {
    try {
        const result = getAddress(value);
        if (result === zeroAddress)
            throw new Error("zero");
        return result;
    }
    catch {
        return fail("APN_INVALID_INPUT", "address");
    }
}
function hex32(value) {
    if (typeof value !== "string" || !HASH.test(value))
        return fail("APN_RPC_PROTOCOL", "hash");
    return value;
}
function rpcQuantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value))
        return fail("APN_RPC_PROTOCOL", "quantity");
    return BigInt(value);
}
export class FileStargateNativeJournal {
    root;
    constructor(root) {
        this.root = root;
    }
    path(id) {
        if (!/^[a-f0-9]{64}$/u.test(id))
            fail("APN_STATE_CORRUPT", "operation_id");
        return join(this.root, "stargate-v2-native", `${id}.json`);
    }
    async load(id) {
        try {
            return validateRecord(JSON.parse(await readFile(this.path(id), "utf8")));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw error;
        }
    }
    async save(nextInput) {
        const next = validateRecord(nextInput), path = this.path(next.operationId), previous = await this.load(next.operationId);
        validateAdvance(previous, next);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, `${canonicalJson(next)}\n`, { mode: 0o600 });
        await rename(temp, path);
    }
}
export class LocalStargateNativeSigner {
    state;
    wallets;
    constructor(state, wrapping) {
        this.state = state;
        this.wallets = new EncryptedWalletStore(state, wrapping);
    }
    async port(profileInput, expectedOwner) {
        const profile = canonicalProfile(profileInput), owner = address(expectedOwner), profileHash = this.state.profileHash(profile);
        return { kind: "imported_evm_signer", address: owner, signTransaction: async (tx) => await this.state.withLocks([`custody:${profileHash}`], async () => {
                const wallet = await this.wallets.describe(profile);
                if (wallet === null)
                    fail("APN_OPERATION_BLOCKED", "wallet_missing");
                try {
                    if (wallet.identity.profile !== profile || wallet.identity.address !== owner ||
                        privateKeyToAccount(wallet.secret.privateKey).address !== owner)
                        fail("APN_OPERATION_BLOCKED", "wallet_owner");
                    return await privateKeyToAccount(wallet.secret.privateKey).signTransaction({ type: "eip1559", chainId: tx.chainId, to: tx.to, data: tx.data,
                        value: BigInt(tx.valueAtomic), nonce: Number(uint(tx.nonceAtomic)), gas: uint(tx.gasLimitAtomic, true),
                        maxFeePerGas: uint(tx.maxFeePerGasAtomic, true), maxPriorityFeePerGas: uint(tx.maxPriorityFeePerGasAtomic), accessList: [] });
                }
                finally {
                    this.wallets.clear(wallet.secret);
                }
            }) };
    }
}
export async function prepareStargateV2NativeEth(request, ports, journal) {
    const now = ports.now ?? Date.now, profile = canonicalProfile(request.profile), owner = address(request.owner), recipient = address(request.recipient);
    if (owner !== recipient)
        fail("APN_OPERATION_BLOCKED", "first_lane_requires_self_recipient");
    if (ports.signer.kind !== "imported_evm_signer" || address(ports.signer.address) !== owner)
        fail("APN_OPERATION_BLOCKED", "signer_owner");
    const amount = uint(request.amountAtomic, true), cap = uint(request.maxNativeDebitAtomic, true);
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(request.idempotencyKey))
        fail("APN_INVALID_INPUT", "idempotency_key");
    const ttl = request.ttlMs ?? 60_000;
    if (!Number.isSafeInteger(ttl) || ttl < 15_000 || ttl > MAX_TTL_MS)
        fail("APN_INVALID_INPUT", "ttl");
    const profileHash = hashObject({ profile }), idempotencyHash = hashObject({ idempotencyKey: request.idempotencyKey });
    const operationId = hashObject({ family: "stargate_v2_native", profileHash, idempotencyHash });
    const existing = await journal.load(operationId);
    if (existing !== null) {
        if (existing.profile !== profile || existing.owner !== owner || existing.recipient !== recipient ||
            existing.amountAtomic !== amount.toString() || existing.maxNativeDebitAtomic !== cap.toString()) {
            fail("APN_OPERATION_BLOCKED", "idempotency_conflict");
        }
        return existing;
    }
    const quote = await quoteStargateV2Direct({ sourceChainId: SOURCE_CHAIN, destinationChainId: DESTINATION_CHAIN,
        sourceToken: "native", destinationToken: "native", recipient, amountAtomic: amount.toString() }, ports.sourceCall);
    assertLane(quote);
    const quoteTag = `0x${BigInt(quote.block.numberAtomic).toString(16)}`;
    const config = await readSourceConfig(ports.sourceCall, quoteTag);
    const sendParam = { dstEid: DESTINATION_EID, to: pad(recipient, { size: 32 }), amountLD: amount,
        minAmountLD: BigInt(quote.quote.minimumOutputAtomic), extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const finalFee = await requoteFinalSend(ports.sourceCall, sendParam, quoteTag);
    if (finalFee !== BigInt(quote.quote.nativeMessageFeeAtomic))
        fail("APN_REPREPARE_REQUIRED", "final_send_fee_differs");
    const value = amount + finalFee;
    const data = encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: "sendToken",
        args: [sendParam, { nativeFee: finalFee, lzTokenFee: 0n }, owner] });
    const prepared = await ports.prepareEnvelope({ chainId: SOURCE_CHAIN, from: owner, to: SOURCE_POOL, data, valueAtomic: value.toString() });
    const gasUpper = uint(prepared.gasLimitAtomic, true) * uint(prepared.maxFeePerGasAtomic, true), maximumDebit = value + gasUpper;
    if (uint(prepared.maxPriorityFeePerGasAtomic) > uint(prepared.maxFeePerGasAtomic, true))
        fail("APN_RPC_PROTOCOL", "priority_fee");
    if (maximumDebit > cap)
        fail("APN_OPERATION_BLOCKED", "max_native_debit_exceeded");
    if (uint(prepared.nativeBalanceAtomic) < maximumDebit)
        fail("APN_OPERATION_BLOCKED", "insufficient_native_balance");
    const destination = await ports.destinationBalance(recipient);
    uint(destination.balanceAtomic);
    uint(destination.blockNumberAtomic);
    hex32(destination.blockHash);
    const preparedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + ttl).toISOString();
    const body = {
        schemaVersion: "apn.stargate-v2-native-operation.v1", operationId, profile, profileHash, idempotencyHash,
        owner, recipient, amountAtomic: amount.toString(), maxNativeDebitAtomic: cap.toString(), sourcePool: SOURCE_POOL,
        destinationPool: DESTINATION_POOL, sourceEid: SOURCE_EID, destinationEid: DESTINATION_EID, quote, sourceCodeHash: config.codeHash,
        destinationBalanceBeforeAtomic: destination.balanceAtomic, destinationBalanceBlock: { numberAtomic: destination.blockNumberAtomic, hash: destination.blockHash },
        envelope: { chainId: SOURCE_CHAIN, from: owner, to: SOURCE_POOL, data, valueAtomic: value.toString(), nonceAtomic: uint(prepared.nonceAtomic).toString(),
            gasLimitAtomic: uint(prepared.gasLimitAtomic, true).toString(), maxFeePerGasAtomic: uint(prepared.maxFeePerGasAtomic, true).toString(),
            maxPriorityFeePerGasAtomic: uint(prepared.maxPriorityFeePerGasAtomic).toString() },
        totalValueAtomic: value.toString(), maximumDebitAtomic: maximumDebit.toString(), preparedAt, expiresAt,
        phase: "prepared", transitions: [{ phase: "prepared", at: preparedAt, reason: "fresh_quote_and_envelope_frozen" }],
    };
    const operation = seal(body);
    await journal.save(operation);
    return operation;
}
export async function executeStargateV2NativeEth(operationId, ports, journal) {
    let operation = await journal.load(operationId);
    if (operation === null)
        fail("APN_OPERATION_BLOCKED", "operation_missing");
    if (["submission_started", "submitted", "unknown_finality"].includes(operation.phase))
        return await observeOnly(operation, ports, journal);
    if (operation.phase === "observed")
        return operation;
    const now = ports.now ?? Date.now;
    if (Date.parse(operation.expiresAt) <= now())
        fail("APN_REPREPARE_REQUIRED", "expired");
    if (operation.phase === "prepared") {
        await ports.approve(operation);
        operation = transition(operation, "approved", "foreground_owner_confirmation", now());
        await journal.save(operation);
    }
    if (Date.parse(operation.expiresAt) <= now())
        fail("APN_REPREPARE_REQUIRED", "expired_after_approval");
    const fresh = await quoteStargateV2Direct({ sourceChainId: 1, destinationChainId: 130, sourceToken: "native", destinationToken: "native",
        recipient: operation.recipient, amountAtomic: operation.amountAtomic }, ports.sourceCall);
    assertLane(fresh);
    if (fresh.quote.amountSentAtomic !== operation.quote.quote.amountSentAtomic ||
        fresh.quote.minimumOutputAtomic !== operation.quote.quote.minimumOutputAtomic ||
        fresh.quote.nativeMessageFeeAtomic !== operation.quote.quote.nativeMessageFeeAtomic) {
        fail("APN_REPREPARE_REQUIRED", "quote_changed_after_approval");
    }
    // These identity/config reads are deliberately the final network operations before local signing.
    const config = await readSourceConfig(ports.sourceCall, "latest");
    if (config.codeHash !== operation.sourceCodeHash)
        fail("APN_REPREPARE_REQUIRED", "source_code_changed");
    const raw = await ports.signer.signTransaction(operation.envelope), transactionHash = keccak256(raw);
    operation = seal({ ...operation, phase: "submission_started", transactionHash,
        transitions: [...operation.transitions, { phase: "submission_started", at: new Date(now()).toISOString(), reason: "attempt_marked_before_send" }] });
    await journal.save(operation);
    try {
        const returned = await ports.sendRawTransaction(raw);
        if (returned.toLowerCase() !== transactionHash.toLowerCase())
            fail("APN_RPC_AMBIGUOUS", "returned_transaction_hash");
        operation = transition(operation, "submitted", "broadcast_returned_exact_hash", now());
        await journal.save(operation);
    }
    catch {
        operation = transition(operation, "unknown_finality", "broadcast_result_ambiguous_no_resend", now());
        await journal.save(operation);
        return operation;
    }
    return await observeOnly(operation, ports, journal);
}
async function observeOnly(input, ports, journal) {
    let operation = input;
    if (operation.transactionHash === undefined)
        fail("APN_STATE_CORRUPT", "attempt_without_hash");
    const receipt = await ports.waitSourceReceipt(operation.transactionHash);
    if (receipt === null) {
        if (operation.phase !== "unknown_finality") {
            operation = transition(operation, "unknown_finality", "source_receipt_not_safe", (ports.now ?? Date.now)());
            await journal.save(operation);
        }
        return operation;
    }
    const source = sourceReceipt(operation, receipt);
    const destination = await ports.observeDestination({ guid: source.guid, recipient: operation.recipient, sourceEid: SOURCE_EID,
        destinationPool: DESTINATION_POOL, minimumAmountAtomic: source.amountReceivedAtomic, balanceBeforeAtomic: operation.destinationBalanceBeforeAtomic });
    if (destination === null) {
        if (operation.sourceReceipt === undefined) {
            const transitions = operation.phase === "submitted" ? operation.transitions : [...operation.transitions,
                { phase: "submitted", at: new Date((ports.now ?? Date.now)()).toISOString(), reason: "source_safe_destination_pending" }];
            operation = seal({ ...operation, phase: "submitted", sourceReceipt: source, transitions });
            await journal.save(operation);
        }
        return operation;
    }
    validateDestination(operation, source, destination);
    operation = seal({ ...operation, phase: "observed", guid: source.guid, sourceReceipt: source, destinationEvidence: destination,
        transitions: [...operation.transitions, { phase: "observed", at: new Date((ports.now ?? Date.now)()).toISOString(), reason: "destination_delivery_safe" }] });
    await journal.save(operation);
    return operation;
}
function sourceReceipt(operation, receipt) {
    if (receipt.status !== "success" || receipt.finality !== "safe" || receipt.transactionHash !== operation.transactionHash)
        fail("APN_RPC_PROTOCOL", "source_receipt");
    const events = receipt.logs.flatMap(log => {
        if (address(log.address) !== SOURCE_POOL)
            return [];
        try {
            const event = decodeEventLog({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", topics: log.topics, data: log.data });
            return [event.args];
        }
        catch {
            return [];
        }
    });
    if (events.length !== 1)
        fail("APN_RPC_PROTOCOL", "source_oft_sent_count");
    const event = events[0];
    if (event.dstEid !== DESTINATION_EID || address(event.fromAddress) !== operation.owner ||
        event.amountSentLD.toString() !== operation.quote.quote.amountSentAtomic ||
        event.amountReceivedLD.toString() !== operation.quote.quote.minimumOutputAtomic)
        fail("APN_RPC_PROTOCOL", "source_oft_sent_binding");
    return { transactionHash: operation.transactionHash, blockNumberAtomic: uint(receipt.blockNumberAtomic).toString(), blockHash: hex32(receipt.blockHash),
        finality: "safe", guid: hex32(event.guid), amountSentAtomic: event.amountSentLD.toString(), amountReceivedAtomic: event.amountReceivedLD.toString() };
}
function validateDestination(operation, source, evidence) {
    if (evidence.finality !== "safe" || address(evidence.recipient) !== operation.recipient)
        fail("APN_RPC_PROTOCOL", "destination_binding");
    uint(evidence.blockNumberAtomic);
    hex32(evidence.blockHash);
    if (evidence.mode === "oft_received") {
        if (evidence.guid !== source.guid || uint(evidence.amountReceivedAtomic) < uint(source.amountReceivedAtomic))
            fail("APN_RPC_PROTOCOL", "destination_event");
    }
    else {
        if (evidence.balanceBeforeAtomic !== operation.destinationBalanceBeforeAtomic ||
            uint(evidence.balanceAfterAtomic) - uint(evidence.balanceBeforeAtomic) !== uint(evidence.deltaAtomic) ||
            uint(evidence.deltaAtomic) < uint(source.amountReceivedAtomic))
            fail("APN_RPC_PROTOCOL", "destination_balance_delta");
    }
}
async function readSourceConfig(call, tag) {
    if (rpcQuantity(await call("eth_chainId", [])) !== 1n)
        fail("APN_CHAIN_MISMATCH", "source_chain_id");
    const code = await call("eth_getCode", [SOURCE_POOL, tag]);
    if (typeof code !== "string" || !CODE.test(code) || code === "0x")
        fail("APN_RPC_PROTOCOL", "source_code");
    const read = async (name) => decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: name,
        data: await call("eth_call", [{ to: SOURCE_POOL, data: encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: name }) }, tag]) });
    const [token, eid, decimals] = await Promise.all([read("token"), read("localEid"), read("sharedDecimals")]);
    let configuredToken;
    try {
        configuredToken = getAddress(token);
    }
    catch {
        return fail("APN_RPC_PROTOCOL", "source_contract_config");
    }
    if (configuredToken !== zeroAddress || eid !== SOURCE_EID || decimals !== 6)
        fail("APN_RPC_PROTOCOL", "source_contract_config");
    if (rpcQuantity(await call("eth_chainId", [])) !== 1n)
        fail("APN_CHAIN_MISMATCH", "source_chain_drift");
    return { codeHash: keccak256(code) };
}
async function requoteFinalSend(call, sendParam, tag) {
    const data = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", args: [sendParam, false] });
    const raw = await call("eth_call", [{ to: SOURCE_POOL, data }, tag]);
    if (typeof raw !== "string")
        fail("APN_RPC_PROTOCOL", "final_quote_send");
    const [fee] = decodeAbiParameters(STARGATE_QUOTE_SEND_OUTPUT, raw);
    if (fee.lzTokenFee !== 0n)
        fail("APN_RPC_PROTOCOL", "lz_token_fee");
    return fee.nativeFee;
}
function assertLane(quote) {
    const r = quote.route;
    if (r.sourceChainId !== SOURCE_CHAIN || r.destinationChainId !== DESTINATION_CHAIN || r.sourceEid !== SOURCE_EID ||
        r.destinationEid !== DESTINATION_EID || r.sourcePool !== SOURCE_POOL || r.destinationPool !== DESTINATION_POOL || r.asset !== "ETH") {
        fail("APN_OPERATION_BLOCKED", "lane");
    }
}
function transition(operation, phase, reason, at) {
    return seal({ ...operation, phase, transitions: [...operation.transitions, { phase, at: new Date(at).toISOString(), reason }] });
}
function seal(value) {
    const { integrityHash: _old, ...body } = value;
    return Object.freeze({ ...body, integrityHash: hashObject(body) });
}
function validateRecord(value) {
    if (!isPlainRecord(value) || value.schemaVersion !== "apn.stargate-v2-native-operation.v1")
        fail("APN_STATE_CORRUPT", "schema");
    const record = value, { integrityHash, ...body } = record;
    if (hashObject(body) !== integrityHash || record.transitions.at(-1)?.phase !== record.phase || record.operationId.length !== 64)
        fail("APN_STATE_CORRUPT", "integrity");
    const order = ["prepared", "approved", "submission_started", "submitted", "observed"];
    for (let i = 1; i < record.transitions.length; i++) {
        const a = record.transitions[i - 1].phase, b = record.transitions[i].phase;
        if (b === "unknown_finality") {
            if (!["submission_started", "submitted"].includes(a))
                fail("APN_STATE_CORRUPT", "transition");
        }
        else if (a === "unknown_finality") {
            if (!["submitted", "observed"].includes(b))
                fail("APN_STATE_CORRUPT", "transition");
        }
        else if (order.indexOf(b) < order.indexOf(a) || order.indexOf(b) > order.indexOf(a) + 1)
            fail("APN_STATE_CORRUPT", "transition");
    }
    return record;
}
function validateAdvance(previous, next) {
    if (previous === null) {
        if (next.phase !== "prepared" || next.transitions.length !== 1)
            fail("APN_STATE_CORRUPT", "initial_state");
        return;
    }
    const frozen = (x) => {
        const { phase: _p, transitions: _t, integrityHash: _i, transactionHash: _h, guid: _g, sourceReceipt: _s, destinationEvidence: _d, ...rest } = x;
        return rest;
    };
    if (canonicalJson(frozen(previous)) !== canonicalJson(frozen(next)) || next.transitions.length < previous.transitions.length ||
        canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) ||
        (previous.transactionHash !== undefined && previous.transactionHash !== next.transactionHash))
        fail("APN_STATE_CORRUPT", "journal_rewrite");
}
export function stargateV2NativeCanonicalReceipt(operationInput) {
    const operation = validateRecord(operationInput);
    if (operation.phase !== "observed" || operation.sourceReceipt === undefined || operation.destinationEvidence === undefined) {
        fail("APN_OPERATION_BLOCKED", "receipt_not_observed");
    }
    const body = { schemaVersion: "apn.stargate-v2-native-receipt.v1", operationId: operation.operationId,
        profile: operation.profile, route: { sourceChainId: SOURCE_CHAIN, sourceEid: SOURCE_EID, sourcePool: SOURCE_POOL,
            destinationChainId: DESTINATION_CHAIN, destinationEid: DESTINATION_EID, destinationPool: DESTINATION_POOL },
        owner: operation.owner, recipient: operation.recipient, principalAtomic: operation.amountAtomic,
        nativeMessageFeeAtomic: operation.quote.quote.nativeMessageFeeAtomic, totalValueAtomic: operation.totalValueAtomic,
        maximumDebitAtomic: operation.maximumDebitAtomic, quoteHash: operation.quote.quoteHash,
        source: operation.sourceReceipt, destination: operation.destinationEvidence };
    return Object.freeze({ ...body, evidenceHash: hashObject(body) });
}
//# sourceMappingURL=native-execution.js.map