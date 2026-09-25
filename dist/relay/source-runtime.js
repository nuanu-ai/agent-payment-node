/** Explicit, foreground Ethereum source execution for one saved Relay operation. */
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord, recheckEvmBlock } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { isGrantedPermissionRecord } from "../metamask-smart-account-record.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { HttpsBaseRpc } from "../rpc.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { RelayApprovalEffectService, RelayEncryptedApprovalCustody } from "./approval-effect.js";
import { RelayDepositEffectService, RelayEncryptedDepositCustody } from "./deposit-effect.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
const HASH = /^[a-f0-9]{64}$/u;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Relay source execution is blocked.", { reason }); }
function corrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", `Relay source execution state is invalid: ${reason}.`); }
class RelayExecutionAdmissionStore extends SecureStateStore {
    path(op) { return `relay-execution-admissions/${op.profileHash}/${op.operationId}.json`; }
    async load(op) {
        const value = await this.readJson(this.path(op));
        if (value === null)
            return null;
        if (typeof value !== "object" || Array.isArray(value))
            corrupt("admission shape");
        const record = value;
        const { integrityHash, ...body } = record;
        if (Object.keys(record).sort().join(",") !== ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash",
            "quoteDigest", "requestId", "confirmedAt", "integrityHash"].sort().join(",") ||
            record.schemaVersion !== "apn.relay-execution-admission.v1" || record.profileHash !== op.profileHash ||
            record.operationId !== op.operationId || record.operationIntegrityHash !== op.integrityHash ||
            record.quoteDigest !== op.quoteDigest || record.requestId !== op.statusLocator?.requestId ||
            !Number.isFinite(Date.parse(record.confirmedAt)) || record.integrityHash !== hashObject(body))
            corrupt("admission binding");
        return record;
    }
    async admit(op, now) {
        stateIdentifier(op.operationId, "Relay operation");
        await this.initialize();
        return this.withLocks([`relay-admission:${op.operationId}`], async () => {
            const old = await this.load(op);
            if (old !== null)
                return old;
            if (op.statusLocator === undefined || !Number.isFinite(now.getTime()))
                blocked("request_id_or_clock");
            const body = { schemaVersion: "apn.relay-execution-admission.v1", profileHash: op.profileHash,
                operationId: op.operationId, operationIntegrityHash: op.integrityHash, quoteDigest: op.quoteDigest,
                requestId: op.statusLocator.requestId, confirmedAt: now.toISOString() };
            const record = { ...body, integrityHash: hashObject(body) };
            await this.ensureDirectory(`relay-execution-admissions/${op.profileHash}`);
            await this.writeJson(this.path(op), record, true);
            return record;
        });
    }
}
/** Production constructor uses one explicit public HTTPS Ethereum RPC, with no Relay credential. */
export function createRelayEthereumSourceRuntime(state, wrappingSecret, rpcUrl, authorization, clock = { now: () => new Date() }) {
    let endpoint;
    try {
        endpoint = new URL(rpcUrl);
    }
    catch {
        throw new ApnError("APN_RPC_CONFIG", "Relay execution requires one HTTPS RPC URL.");
    }
    if (endpoint.pathname !== "/" || endpoint.search !== "" || endpoint.hash !== "" || endpoint.username !== "" || endpoint.password !== "")
        throw new ApnError("APN_RPC_CONFIG", "Relay execution requires a keyless HTTPS RPC origin without a signed path or query.");
    return new RelayEthereumSourceRuntime(state, wrappingSecret, new HttpsBaseRpc(rpcUrl), authorization, clock);
}
/** The constructor accepts an injected RPC surface so tests can never reach a network. */
export class RelayEthereumSourceRuntime {
    state;
    rpc;
    authorization;
    clock;
    wallets;
    permissions;
    admissions;
    usage;
    approvalCustody;
    depositCustody;
    signingNonce = null;
    constructor(state, wrapping, rpc, authorization, clock = { now: () => new Date() }) {
        this.state = state;
        this.rpc = rpc;
        this.authorization = authorization;
        this.clock = clock;
        this.wallets = new EncryptedWalletStore(state, wrapping);
        this.permissions = new EncryptedSmartAccountPermissionStore(state, wrapping);
        this.admissions = new RelayExecutionAdmissionStore(state.root);
        this.usage = new AssetUsageLedger(state.root);
        this.approvalCustody = new RelayEncryptedApprovalCustody(state, wrapping);
        this.depositCustody = new RelayEncryptedDepositCustody(state, wrapping);
    }
    async execute(operationId) {
        if (!HASH.test(operationId))
            throw new ApnError("APN_INVALID_INPUT", "Relay execution requires one operation ID.");
        const profileHash = this.state.profileHash("default");
        const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, operationId);
        if (op === null)
            blocked("prepared_operation_missing");
        this.assertPrepared(op);
        return this.state.withLocks([`relay-source-execute:${operationId}`, evmAddressLock(op.sourceAccount)], async () => {
            const existing = await new RelayEffectJournalRepository(this.state.root).load(profileHash, operationId);
            const observationOnly = existing !== null && (existing.effects[0].phase === "submitting" ||
                existing.effects[1].phase === "submitting" || existing.effects[0].phase === "failed" ||
                existing.effects[1].phase === "failed" || existing.effects[1].phase === "confirmed");
            if (observationOnly) {
                if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
                    blocked("operation_retired");
                await this.assertOwner(op);
            }
            else
                await this.assertReady(op);
            const summary = this.summary(op);
            if (await this.authorization.confirm(summary) !== true)
                blocked("foreground_authorization_declined");
            if (observationOnly) {
                if (await this.admissions.load(op) === null)
                    blocked("execution_admission_missing");
            }
            else
                await this.assertReady(op);
            // The same exact operation/requestId is persisted before any effect can be marked.
            if (!observationOnly) {
                await this.admissions.admit(op, this.clock.now());
                const active = await this.activePolicy(op);
                if (active === null)
                    blocked("active_policy_missing");
                await this.usage.reserve({ account: getAddress(op.sourceAccount), chain: "eip155:1",
                    asset: { kind: "token", identifier: ETHEREUM_USDC }, registry: active.registry,
                    rail: "bridge", amountAtomic: op.amountAtomic, idempotencyKey: `relay-execute:${op.operationId}`, now: this.clock.now() });
            }
            const common = {
                now: () => this.clock.now(),
                activePolicy: async () => this.activePolicy(op),
                publicAccount: async () => this.publicAccount(op),
                dailyUsage: async (_account, now) => this.dailyUsageExcludingOwn(op, now),
                executionAdmission: async () => {
                    const record = await this.admissions.load(op);
                    return record === null ? null : { requestId: record.requestId, operationIntegrityHash: record.operationIntegrityHash,
                        quoteDigest: record.quoteDigest };
                },
                funding: async () => this.funding(op),
                send: async (raw) => this.rpc.submitRawTransaction(raw),
            };
            const approvalPorts = { ...common,
                sign: async (operation) => this.sign(operation, "approval"), custody: this.approvalCustody,
                observe: async (hash) => this.observeApproval(hash) };
            const depositPorts = { ...common,
                sign: async (operation) => this.sign(operation, "deposit"), custody: this.depositCustody,
                observeApproval: async (hash) => this.observeApproval(hash), observe: async (hash) => this.observeDeposit(hash) };
            let journal = await new RelayApprovalEffectService(this.state, approvalPorts).run(operationId);
            await this.updateUsage(op, journal);
            if (journal.effects[0].phase === "confirmed")
                journal = await new RelayDepositEffectService(this.state, depositPorts).run(operationId);
            await this.updateUsage(op, journal);
            return journal;
        });
    }
    assertPrepared(op) {
        validateRelayUnsignedOperation(op);
        if (op.sourceChainId !== 1 || op.destinationChainId !== 56 || op.quote === undefined || op.statusLocator === undefined ||
            op.policyDigest === undefined || op.policyRevision === undefined || op.approvalNetworkFeeCeilingWei === undefined ||
            op.depositNetworkFeeCeilingWei === undefined || op.quote.statusLocator?.requestId !== op.statusLocator.requestId ||
            op.quote.quoteDigest !== op.quoteDigest)
            blocked("saved_quote_or_request_id_required");
    }
    summary(op) {
        this.assertPrepared(op);
        return { operationId: op.operationId, sourceChainId: 1, destinationChainId: 56, sourceAccount: op.sourceAccount,
            sourceToken: ETHEREUM_USDC, amountAtomic: op.amountAtomic, recipient: op.recipient,
            minOutputAtomic: op.minOutputAtomic, deadline: op.deadline, requestId: op.statusLocator.requestId,
            quoteDigest: op.quoteDigest, approvalNetworkFeeCeilingWei: op.approvalNetworkFeeCeilingWei,
            depositNetworkFeeCeilingWei: op.depositNetworkFeeCeilingWei };
    }
    async assertReady(op) {
        this.assertPrepared(op);
        if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
            blocked("operation_retired");
        const now = this.clock.now();
        if (!Number.isFinite(now.getTime()) || now.getTime() + 60_000 >= Date.parse(op.deadline))
            blocked("quote_deadline");
        await this.assertOwner(op);
        const active = await this.activePolicy(op);
        if (active === null || active.digest !== op.policyDigest || active.revision !== op.policyRevision ||
            !same(active.accounts.evm ?? "", op.sourceAccount))
            blocked("active_policy_or_owner");
        if (!same(await this.publicAccount(op) ?? "", op.sourceAccount))
            blocked("public_owner");
    }
    async assertOwner(op) {
        // execute holds evmAddressLock from before confirmation through the first send.
        await assertExclusiveEvmOwner(this.state, op.sourceAccount, op.profileHash);
        const profile = await this.state.loadProviderProfile(op.profileHash);
        if (profile !== null && !same(profile.public_address, op.sourceAccount))
            blocked("public_provider_profile_changed");
        const publicWallet = await this.state.loadWallet(op.profileHash);
        if (publicWallet !== null && !same(publicWallet.address, op.sourceAccount))
            blocked("public_wallet_profile_changed");
        for (const record of await this.permissions.listAll()) {
            if (isGrantedPermissionRecord(record) && same(record.owner_address, op.sourceAccount) && record.profile_hash !== op.profileHash)
                blocked("foreign_encrypted_metamask_grant");
        }
    }
    async activePolicy(op) {
        await this.assertOwner(op);
        return loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, "default");
    }
    async publicAccount(op) {
        const wallet = await this.wallets.describe("default");
        if (wallet === null)
            return null;
        try {
            return same(wallet.identity.address, op.sourceAccount) ? wallet.identity.address : null;
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
    async dailyUsageExcludingOwn(op, now) {
        const identity = { account: getAddress(op.sourceAccount), chain: "eip155:1",
            asset: { kind: "token", identifier: ETHEREUM_USDC } };
        const id = assetUsageReservationId(identity, `relay-execute:${op.operationId}`);
        const result = await this.usage.usageWithReservation(identity, id, now);
        if (result.reservation === null || result.reservation.amountAtomic !== op.amountAtomic ||
            result.reservation.policyDigest !== op.policyDigest)
            blocked("usage_reservation_missing_or_changed");
        const total = BigInt(result.snapshot.amountAtomic);
        const own = result.reservation.reservedAt.slice(0, 10) === now.toISOString().slice(0, 10)
            ? BigInt(op.amountAtomic) : 0n;
        if (total < own)
            corrupt("usage total below own reservation");
        return (total - own).toString();
    }
    async funding(op) {
        await this.assertOwner(op);
        const heads = await this.rpc.batchCall([{ method: "eth_chainId", params: [] },
            { method: "eth_getBlockByNumber", params: ["latest", false] }]);
        if (heads.length !== 2 || evmRpcQuantity(heads[0]) !== 1n)
            blocked("ethereum_rpc_chain");
        const head = evmRpcRecord(heads[1]), block = evmRpcQuantity(head.number), blockHash = evmRpcHex(head.hash, 32);
        if (blockHash === `0x${"0".repeat(64)}`)
            corrupt("zero source block hash");
        const reference = { blockHash, requireCanonical: true };
        const balanceData = `0x70a08231${op.sourceAccount.slice(2).toLowerCase().padStart(64, "0")}`;
        const allowanceData = `0xdd62ed3e${op.sourceAccount.slice(2).toLowerCase().padStart(64, "0")}${ETHEREUM_DEPOSITORY.slice(2).padStart(64, "0")}`;
        const rows = await this.rpc.batchCall([
            { method: "eth_getBlockByNumber", params: [`0x${block.toString(16)}`, false] },
            { method: "eth_getBalance", params: [op.sourceAccount, reference] },
            { method: "eth_call", params: [{ to: ETHEREUM_USDC, data: balanceData }, reference] },
            { method: "eth_call", params: [{ to: ETHEREUM_USDC, data: allowanceData }, reference] },
            { method: "eth_getTransactionCount", params: [op.sourceAccount, "pending"] },
            { method: "eth_maxPriorityFeePerGas", params: [] },
            { method: "eth_chainId", params: [] },
        ]);
        if (rows.length !== 7 || evmRpcQuantity(rows[6]) !== 1n)
            blocked("ethereum_rpc_chain");
        const canonical = evmRpcRecord(rows[0]);
        if (evmRpcQuantity(canonical.number) !== block || evmRpcHex(canonical.hash, 32) !== blockHash)
            blocked("source_block_changed");
        const priority = evmRpcQuantity(rows[5]), baseFee = evmRpcQuantity(head.baseFeePerGas);
        const nonce = evmRpcQuantity(rows[4]);
        this.signingNonce = nonce;
        const currentMaxFeePerGasWei = baseFee * 2n + priority;
        if (currentMaxFeePerGasWei === 0n)
            blocked("source_fee_unavailable");
        return { chainId: 1, nativeBalanceWei: evmRpcQuantity(rows[1]), tokenBalanceAtomic: evmRpcWord(rows[2]),
            allowanceAtomic: evmRpcWord(rows[3]), currentMaxFeePerGasWei, nextNonce: nonce };
    }
    async sign(op, role) {
        await this.assertReady(op);
        const nonce = this.signingNonce;
        this.signingNonce = null;
        if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER))
            blocked("signing_nonce_missing_or_unbounded");
        const wallet = await this.wallets.describe("default");
        if (wallet === null)
            blocked("encrypted_wallet_missing");
        try {
            if (!same(wallet.identity.address, op.sourceAccount))
                blocked("encrypted_wallet_owner");
            const account = privateKeyToAccount(wallet.secret.privateKey);
            if (!same(account.address, op.sourceAccount))
                corrupt("local_signer_owner");
            const envelope = role === "approval" ? op.quote.approval : op.quote.deposit;
            return await account.signTransaction({ type: "eip1559", chainId: 1, to: envelope.to,
                data: envelope.data, value: 0n, nonce: Number(nonce), gas: BigInt(envelope.gas),
                maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas), accessList: [] });
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
    async observeApproval(hash) {
        const found = await this.observation(hash);
        if (found === null)
            return null;
        return { transaction: { hash, from: found.from, to: found.to, input: found.input, chainId: 1 },
            receipt: { transactionHash: hash, status: found.status, blockNumber: found.blockNumber,
                blockHash: found.blockHash, logs: found.logs }, canonicalBlockHash: found.blockHash };
    }
    async observeDeposit(hash) {
        const found = await this.observation(hash);
        if (found === null)
            return null;
        return { transaction: { hash, from: found.from, to: found.to, input: found.input, value: found.value, chainId: 1 },
            receipt: { transactionHash: hash, status: found.status, blockNumber: found.blockNumber,
                blockHash: found.blockHash }, canonicalBlockHash: found.blockHash };
    }
    async observation(hash) {
        const call = this.rpc.coinbaseGaslessCall?.bind(this.rpc);
        if (call === undefined)
            blocked("ethereum_observer_unavailable");
        const blockCall = async (method, params) => {
            if (method !== "eth_getBlockByNumber")
                blocked("ethereum_observer_method");
            return call(method, params);
        };
        const [rawTx, rawReceipt] = await Promise.all([
            call("eth_getTransactionByHash", [hash]), call("eth_getTransactionReceipt", [hash]),
        ]);
        if (rawTx === null && rawReceipt === null)
            return null;
        if (rawTx === null || rawReceipt === null)
            return null;
        const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
        if (evmRpcHex(tx.hash, 32) !== hash || evmRpcHex(receipt.transactionHash, 32) !== hash ||
            evmRpcQuantity(tx.chainId) !== 1n || evmRpcQuantity(tx.type) !== 2n ||
            evmRpcQuantity(tx.blockNumber) !== evmRpcQuantity(receipt.blockNumber) ||
            evmRpcHex(tx.blockHash, 32) !== evmRpcHex(receipt.blockHash, 32))
            corrupt("transaction and receipt identity");
        const number = evmRpcQuantity(receipt.blockNumber);
        const block = await evmRpcBlock(blockCall, `0x${number.toString(16)}`);
        if (block.hash !== evmRpcHex(receipt.blockHash, 32))
            blocked("source_receipt_reorg");
        const finalized = await evmRpcBlock(blockCall, "finalized");
        if (BigInt(finalized.number) < number)
            return null;
        await recheckEvmBlock(blockCall, block);
        await recheckEvmBlock(blockCall, finalized);
        if (evmRpcQuantity(await this.rpc.batchCall([{ method: "eth_chainId", params: [] }]).then(values => values[0])) !== 1n)
            blocked("ethereum_rpc_chain");
        const status = evmRpcQuantity(receipt.status);
        if (status !== 0n && status !== 1n)
            corrupt("receipt status");
        if (!Array.isArray(receipt.logs) || receipt.logs.length > 256)
            corrupt("receipt logs");
        const logs = receipt.logs.map(value => {
            const log = evmRpcRecord(value);
            if (!Array.isArray(log.topics) || log.topics.length > 4 || evmRpcHex(log.transactionHash, 32) !== hash ||
                evmRpcHex(log.blockHash, 32) !== block.hash || evmRpcQuantity(log.blockNumber) !== number || log.removed !== false)
                corrupt("receipt log identity");
            return { address: evmRpcAddress(log.address), topics: log.topics.map(topic => evmRpcHex(topic, 32)),
                data: evmRpcHex(log.data), transactionHash: hash, blockHash: block.hash };
        });
        return { from: evmRpcAddress(tx.from), to: tx.to === null ? null : evmRpcAddress(tx.to),
            input: evmRpcHex(tx.input), value: evmRpcQuantity(tx.value), status: status === 1n ? "success" : "reverted",
            blockNumber: number, blockHash: block.hash, logs };
    }
    async updateUsage(op, journal) {
        const approval = journal.effects[0].phase, deposit = journal.effects[1].phase;
        const state = deposit === "confirmed" ? "finalized" : deposit === "failed" ? "failed_confirmed_revert" :
            approval === "failed" ? "failed_before_effect" : approval === "pending" ? null : "submitted";
        if (state === null)
            return;
        const identity = { account: getAddress(op.sourceAccount), chain: "eip155:1", asset: { kind: "token", identifier: ETHEREUM_USDC } };
        const id = assetUsageReservationId(identity, `relay-execute:${op.operationId}`);
        const existing = await this.usage.load(identity, id);
        if (existing === null)
            corrupt("usage reservation vanished");
        if (existing.state === state)
            return;
        await this.usage.transition({ ...identity, reservationId: id, policyDigest: op.policyDigest, state,
            now: this.clock.now(), ...(state === "finalized" || state === "failed_before_effect" || state === "failed_confirmed_revert"
                ? { outcomeDigest: journal.integrityHash } : {}) });
    }
}
//# sourceMappingURL=source-runtime.js.map