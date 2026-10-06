var _a;
import { assertSigningTime } from "./x402-permit2/production-signing-facts.js";
import { Permit2ProductionSigningFence } from "./x402-permit2/production-signing-fence.js";
import { Permit2ProductionJournal } from "./x402-permit2/production-journal.js";
import { reconstructPermit2ProductionMaterial } from "./x402-permit2/production-material.js";
import { createPermit2ProductionSigned } from "./x402-permit2/production-signed.js";
import { publicPermit2Production } from "./x402-permit2/production-repository.js";
import { parseDirectIntent, parseDirectRecovery } from "./local-wallet-direct-payload.js";
import { parseX402Create, parseX402Recovery, x402RecoveryBinding, publicAuthorization } from "./local-wallet-native-x402-fields.js";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, normalize, parse, resolve, sep } from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domainHash, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { EncryptedWalletStore, walletCustodyLock, } from "./encrypted-wallet-store.js";
import { ApnError } from "./errors.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "./evm-asset.js";
import { parseEvmNativeIntent } from "./evm-native-intent.js";
import { TtyTransferApproval } from "./tty-approval.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
import { publicDirectEffect, publicWalletIdentity as publicIdentity, publicX402Effect } from "./local-wallet-native-public.js";
import { uniswapTokenNonceOwned } from "./swap/uniswap-v3/token-nonce-ownership.js";
export class LocalWalletNative {
    state;
    approval;
    static #permit2Instances = new WeakMap();
    static #permit2Capabilities = new WeakMap();
    static resolvePermit2LocalCapability(native, root) {
        const capability = this.#permit2Instances.get(native);
        if (capability === undefined)
            throw protocol("Selected native has no local Permit2 capability.");
        this.assertPermit2LocalCapability(capability, native, root);
        return capability;
    }
    static assertPermit2LocalCapability(capability, native, root) {
        const owned = this.#permit2Capabilities.get(capability);
        if (owned === undefined || owned.native !== native || owned.root !== root || owned.state.root !== owned.root)
            throw protocol("Permit2 native capability is not owned by this selected instance.");
        return owned.state;
    }
    static #permit2SigningOrigins = new WeakMap();
    static #permit2Executions = new WeakMap();
    static assertPermit2SigningExecution(execution, journal, id) {
        const owned = this.#permit2Executions.get(execution);
        if (owned === undefined || owned.journal !== journal || owned.operationId !== id || owned.root !== journal.root ||
            this.assertPermit2LocalCapability(owned.capability, owned.native, owned.root) !== owned.state)
            throw protocol("Unowned Permit2 native signing execution.");
        Permit2ProductionSigningFence.assertNativeScope(owned.fence, owned.scope, owned.root, id);
        return owned;
    }
    static #permit2RequestExecutions = new WeakMap();
    static #permit2RequestGrants = new WeakMap();
    static assertPermit2RequestExecution(execution, journal, id) {
        const origin = this.#permit2RequestExecutions.get(execution);
        if (origin === undefined || Object.getPrototypeOf(origin.native) !== _a.prototype ||
            origin.journal !== journal || origin.root !== journal.root || origin.operationId !== id ||
            this.assertPermit2LocalCapability(origin.capability, origin.native, origin.root) !== origin.grant.binding.nativeState ||
            origin.grant.binding.purpose !== "sign-and-submit-once")
            throw protocol("Unowned Permit2 native request execution.");
        this.#assertPermit2RequestTime(origin);
        return origin;
    }
    static #assertPermit2RequestTime(origin) {
        const binding = origin.grant.binding, at = binding.clock();
        if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < binding.completedAt ||
            at.getTime() - binding.completedAt > 60_000)
            throw protocol("Permit2 original paid approval expired.");
        assertSigningTime(origin.grant.record, at);
    }
    wallets;
    constructor(state, wrappingSecret, approval = new TtyTransferApproval()) {
        this.state = state;
        this.approval = approval;
        this.wallets = new EncryptedWalletStore(state, wrappingSecret);
        const capability = Object.freeze({ kind: "permit2-local-native-capability" });
        _a.#permit2Instances.set(this, capability);
        _a.#permit2Capabilities.set(capability, { native: this, state, root: state.root, wallets: this.wallets });
    }
    /** Direct chosen-native entry only: no JSON request, caller plan, callback or transport permission. */
    async signPermit2Production(journal, fence, operationId, continuation) {
        const id = operationId, capability = _a.resolvePermit2LocalCapability(this, journal.root);
        const owned = _a.#permit2Capabilities.get(capability);
        const completed = await Permit2ProductionSigningFence.withNativeScope(fence, owned.root, id, async (scope) => {
            Permit2ProductionSigningFence.assertNativeScope(fence, scope, owned.root, id);
            const execution = Object.freeze({ kind: "permit2-native-signing-execution" });
            _a.#permit2Executions.set(execution, { native: this, capability, state: owned.state,
                root: owned.root, journal, fence, scope, operationId: id });
            let loaded = null;
            let account;
            let tokenSignature = null, permit2Signature;
            let capturedAt = NaN;
            const immediate = () => Permit2ProductionJournal.nativeSigningSecond(journal, id, execution, capturedAt);
            const assert = () => Permit2ProductionJournal.assertNativeSigningContinuation(journal, id, execution);
            const guard = async () => {
                await assert();
                const checked = await Permit2ProductionSigningFence.checkNativeScoped(fence, scope, owned.root, id);
                await assert();
                if (checked.fact === null)
                    throw protocol("Permit2 fresh signing observation refused.");
                capturedAt = Date.parse((await Permit2ProductionSigningFence.consumeNativeScoped(fence, scope, checked.fact, owned.root, id)).capturedAt);
                return assert();
            };
            try {
                await Permit2ProductionJournal.claimNativeSigningContinuation(journal, id, continuation, execution);
                const record = await guard();
                immediate();
                loaded = await owned.wallets.describe(record.material.wallet.profile, immediate);
                await assert();
                if (loaded === null)
                    throw protocol("Permit2 local wallet is missing.");
                account = privateKeyToAccount(loaded.secret.privateKey);
                const plan = reconstructPermit2ProductionMaterial(record.material);
                if (loaded.identity.profile !== record.material.wallet.profile ||
                    loaded.identity.address.toLowerCase() !== plan.payer.toLowerCase() ||
                    account.address.toLowerCase() !== plan.payer.toLowerCase())
                    throw protocol("Permit2 actual payer differs from the saved local wallet.");
                await guard();
                if (plan.plan.eip2612 !== null) {
                    await guard();
                    immediate();
                    tokenSignature = await account.signTypedData(plan.plan.eip2612.typedData);
                    await assert();
                    await guard();
                }
                await guard();
                immediate();
                permit2Signature = await account.signTypedData(plan.plan.permit2);
                const current = await assert();
                await guard();
                const bundle = await createPermit2ProductionSigned(current, permit2Signature, tokenSignature, Permit2ProductionJournal.nativeSigningSecond(journal, id, execution));
                await assert();
                await guard();
                return { bundle, grant: Permit2ProductionJournal.nativeOriginBinding(journal, id, execution) };
            }
            finally {
                try {
                    if (loaded !== null)
                        owned.wallets.clear(loaded.secret);
                }
                finally {
                    account = undefined;
                    loaded = null;
                    tokenSignature = null;
                    permit2Signature = undefined;
                    try {
                        Permit2ProductionJournal.releaseNativeSigningContinuation(journal, execution);
                    }
                    finally {
                        _a.#permit2Executions.delete(execution);
                    }
                }
            }
        });
        const saved = await Permit2ProductionJournal.storeNativeSigned(journal, id, completed.bundle);
        const at = completed.grant.binding.clock();
        if (!(at instanceof Date) || !Number.isSafeInteger(at.getTime()) || at.getTime() < completed.grant.binding.completedAt ||
            at.getTime() - completed.grant.binding.completedAt > 60_000 || saved.operationId !== id ||
            saved.material.materialHash !== completed.grant.record.material.materialHash ||
            saved.material.checked.requestHash !== completed.grant.record.material.checked.requestHash ||
            saved.material.checked.challengeHash !== completed.grant.record.material.checked.challengeHash ||
            saved.exposureJournal?.signed?.signedHash !== completed.bundle.signedHash)
            throw protocol("Permit2 signing origin is no longer current.");
        assertSigningTime(saved, at);
        _a.assertPermit2LocalCapability(capability, this, owned.root);
        const signingOrigin = Object.freeze({ kind: "permit2-native-signing-origin" });
        _a.#permit2SigningOrigins.set(signingOrigin, Object.freeze({ native: this, capability, journal, root: owned.root,
            operationId: id, requestHash: saved.material.checked.requestHash, challengeHash: saved.material.checked.challengeHash,
            materialHash: saved.material.materialHash, signedHash: completed.bundle.signedHash, grant: completed.grant }));
        return Object.freeze({ status: publicPermit2Production(saved), signingOrigin });
    }
    /** Claims a genuine paid origin once; metadata admission only, with no key, RPC or HTTP. */
    async beginPermit2ProductionRequest(journal, fence, operationId, signingOrigin) {
        const id = operationId, origin = _a.#permit2SigningOrigins.get(signingOrigin);
        if (origin === undefined || Object.getPrototypeOf(this) !== _a.prototype || origin.native !== this ||
            origin.journal !== journal || origin.root !== journal.root || origin.operationId !== id ||
            origin.capability !== _a.resolvePermit2LocalCapability(this, origin.root) ||
            origin.grant.binding.native !== this || origin.grant.binding.journal !== journal || origin.grant.binding.operationId !== id ||
            origin.grant.binding.root !== origin.root || _a.assertPermit2LocalCapability(origin.capability, this, origin.root) !== origin.grant.binding.nativeState ||
            origin.grant.binding.purpose !== "sign-and-submit-once")
            throw protocol("Permit2 paid signing origin is unavailable.");
        _a.#permit2SigningOrigins.delete(signingOrigin);
        _a.#assertPermit2RequestTime(origin);
        const execution = Object.freeze({ kind: "permit2-native-request-execution" });
        _a.#permit2RequestExecutions.set(execution, origin);
        try {
            await Permit2ProductionSigningFence.withNativeDispatchScope(fence, origin.root, id, async (scope) => {
                const current = await Permit2ProductionSigningFence.nativeDispatchScopeOwner(fence, scope, origin.root, id);
                const r = current.record;
                if (r.material.materialHash !== origin.materialHash || r.material.checked.requestHash !== origin.requestHash ||
                    r.material.checked.challengeHash !== origin.challengeHash || r.exposureJournal?.signed?.signedHash !== origin.signedHash ||
                    current.lease.reservationDigest !== origin.grant.lease.reservationDigest)
                    throw protocol("Permit2 request owner or signed material changed.");
                _a.assertPermit2RequestExecution(execution, journal, id);
            });
            const marked = await Permit2ProductionJournal.markNativeRequestPending(journal, id, execution);
            _a.assertPermit2RequestExecution(execution, journal, id);
            if (marked.proof === null)
                return Object.freeze({ status: publicPermit2Production(marked.record), requestGrant: null });
            const record = Permit2ProductionJournal.consumeNativeFirstRequestProof(journal, id, execution, marked.proof);
            const requestGrant = Object.freeze({ kind: "permit2-native-request-grant" });
            _a.#permit2RequestGrants.set(requestGrant, Object.freeze({ origin, record }));
            return Object.freeze({ status: publicPermit2Production(record), requestGrant });
        }
        finally {
            _a.#permit2RequestExecutions.delete(execution);
        }
    }
    /** Reserved for this actual native's future dedicated sender; no public caller consumption API. */
    #consumePermit2ProductionRequestGrant(grant) {
        const owned = _a.#permit2RequestGrants.get(grant);
        if (owned === undefined || owned.origin.native !== this || Object.getPrototypeOf(this) !== _a.prototype ||
            _a.assertPermit2LocalCapability(owned.origin.capability, this, owned.origin.root) !== owned.origin.grant.binding.nativeState)
            throw protocol("Unowned Permit2 first-request grant.");
        _a.#permit2RequestGrants.delete(grant);
        _a.#assertPermit2RequestTime(owned.origin);
        return owned;
    }
    async request(request) {
        if (request.version !== "apn.native.v1")
            throw protocol("Unsupported custody request version.");
        await this.state.initialize();
        const profile = requestProfile(request.payload);
        return await this.state.withLocks([walletCustodyLock(this.state, profile)], async () => {
            switch (request.operation) {
                case "wallet.ensure": return await this.ensureWallet(profile);
                case "wallet.import": return await this.importWallet(profile, request.payload);
                case "wallet.describe": return await this.describeWallet(profile);
                case "directTransfer.approveAndSign": return await this.approveAndSign(request.payload);
                case "effectMaterial.get": return await this.getEffect(request.payload);
                case "x402Exact.approveAndAuthorize": return await this.approveX402(request.payload);
                case "x402Exact.authorizationMaterial.get": return await this.getX402(request.payload);
            }
        });
    }
    async ensureWallet(profile) {
        const loaded = await this.wallets.ensure(profile);
        try {
            return publicIdentity(loaded.identity);
        }
        finally {
            this.wallets.clear(loaded.secret);
        }
    }
    async importWallet(profile, payload) {
        const keyFile = payload.keyFile;
        const keyName = payload.keyName;
        const expectedAddress = payload.expectedAddress;
        if (typeof keyFile !== "string" || !keyFile.startsWith("/") || typeof keyName !== "string" ||
            !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(keyName) || typeof expectedAddress !== "string") {
            throw new ApnError("APN_INVALID_INPUT", "Wallet import requires an absolute key file, key name, and expected address.");
        }
        if (normalize(keyFile) !== keyFile || resolve(keyFile) !== keyFile) {
            throw new ApnError("APN_STATE_SECURITY", "Wallet key file path must be canonical.");
        }
        let component = parse(keyFile).root;
        for (const part of keyFile.slice(component.length).split(sep).filter(Boolean)) {
            component = join(component, part);
            if ((await lstat(component)).isSymbolicLink()) {
                throw new ApnError("APN_STATE_SECURITY", "Wallet key file path traverses a symbolic link.");
            }
        }
        const handle = await open(keyFile, constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes = Buffer.alloc(0);
        try {
            const before = await handle.stat();
            if (!before.isFile() || before.uid !== process.geteuid?.() || (before.mode & 0o777) !== 0o600 ||
                before.nlink !== 1 || before.size > 64 * 1024) {
                throw new ApnError("APN_STATE_SECURITY", "Wallet key file must be an owner-only regular file of bounded size.");
            }
            bytes = Buffer.alloc(before.size + 1);
            let read = 0;
            while (read < bytes.length) {
                const result = await handle.read(bytes, read, bytes.length - read, read);
                if (result.bytesRead === 0)
                    break;
                read += result.bytesRead;
            }
            const after = await handle.stat();
            if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs || read !== before.size) {
                throw new ApnError("APN_STATE_SECURITY", "Wallet key file changed during import.");
            }
            const lines = bytes.subarray(0, read).toString("utf8").split(/\r?\n/u);
            const matches = lines.map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]*))\s*(?:#.*)?$/u))
                .filter((match) => match?.[1] === keyName);
            if (matches.length !== 1)
                throw new ApnError("APN_INVALID_INPUT", "Wallet key name must occur exactly once in the key file.");
            const match = matches[0];
            const privateKey = match[2] ?? match[3] ?? match[4] ?? "";
            const identity = await this.wallets.importNew(profile, privateKey, expectedAddress);
            return publicIdentity(identity);
        }
        finally {
            bytes.fill(0);
            await handle.close();
        }
    }
    async describeWallet(profile) {
        const loaded = await this.wallets.describe(profile);
        if (loaded === null)
            return { found: false };
        try {
            return { found: true, ...publicIdentity(loaded.identity) };
        }
        finally {
            this.wallets.clear(loaded.secret);
        }
    }
    async approveAndSign(payload) {
        const intent = payload.evm === undefined ? parseDirectIntent(payload) : parseEvmNativeIntent(payload);
        // Human approval must complete before the Keychain-backed wallet envelope
        // is loaded. This keeps the raw signing key out of memory while approval is
        // pending, refused, interrupted, or expired.
        await this.approval.approve(intent);
        return await this.withWallet(intent.profile, async (identity, secret) => {
            assertWallet(identity, intent.walletAddress);
            const slot = effectSlot("apn-effect-v1", intent.profile, intent.operationId, intent.fingerprint);
            const payloadHash = hashObject(payload);
            const existing = secret.directEffects[slot];
            if (existing !== undefined) {
                if (existing.payloadHash !== payloadHash)
                    throw rejected("APN_EFFECT_MISMATCH", "Stored direct-transfer effect differs from the frozen request.");
                return publicDirectEffect(existing);
            }
            if ((intent.evm?.asset.chainId ?? CHAIN_ID) === 1 && await uniswapTokenNonceOwned(this.state.root, identity.address, intent.nonceAtomic)) {
                throw new ApnError("APN_REPREPARE_REQUIRED", "A guarded token effect already owns the approved Ethereum nonce; prepare a fresh transfer.");
            }
            const account = privateKeyToAccount(secret.privateKey);
            const rawTransaction = await account.signTransaction({
                type: "eip1559",
                chainId: intent.evm?.asset.chainId ?? CHAIN_ID,
                to: intent.evm?.transactionTo ?? BASE_USDC,
                value: BigInt(intent.evm?.valueAtomic ?? "0"),
                data: intent.transactionData,
                nonce: Number(BigInt(intent.nonceAtomic)),
                gas: BigInt(intent.gasLimitAtomic),
                maxFeePerGas: BigInt(intent.maxFeePerGasAtomic),
                maxPriorityFeePerGas: BigInt(intent.maxPriorityFeePerGasAtomic),
                accessList: [],
            });
            if (intent.evm !== undefined && (rawTransaction.length - 2) / 2 > MAX_DIRECT_TRANSACTION_BYTES)
                throw protocol("Signed transaction exceeds its data-fee quote size bound.");
            const transactionHash = keccak256(rawTransaction);
            const effect = {
                payloadHash,
                transactionHash,
                rawTransaction,
                rawTransactionHash: transactionHash,
            };
            secret.directEffects[slot] = effect;
            await this.wallets.save(identity, secret);
            return publicDirectEffect(effect);
        });
    }
    async getEffect(payload) {
        const recovery = parseDirectRecovery(payload);
        return await this.withWallet(recovery.profile, async (_identity, secret) => {
            const slot = effectSlot("apn-effect-v1", recovery.profile, recovery.operationId, recovery.fingerprint);
            const effect = secret.directEffects[slot];
            if (effect === undefined) {
                if ("expectedPayloadHash" in recovery)
                    return { found: false };
                throw rejected("APN_EFFECT_NOT_FOUND", "Direct-transfer effect material was not found.");
            }
            if ("expectedPayloadHash" in recovery) {
                if (effect.payloadHash !== recovery.expectedPayloadHash)
                    throw rejected("APN_EFFECT_MISMATCH", "Stored signature does not match the frozen started operation.");
                return publicDirectEffect(effect);
            }
            if (effect.transactionHash.toLowerCase() !== recovery.expectedTransactionHash.toLowerCase() ||
                effect.rawTransactionHash.toLowerCase() !== recovery.expectedRawTransactionHash.toLowerCase())
                throw rejected("APN_EFFECT_MISMATCH", "Direct-transfer recovery binding does not match.");
            return publicDirectEffect(effect);
        });
    }
    async approveX402(payload) {
        const intent = parseX402Create(payload);
        return await this.withWallet(intent.profile, async (identity, secret) => {
            assertWallet(identity, intent.wallet);
            const slot = effectSlot("apn-x402-effect-v1", intent.profile, intent.operationId, intent.fingerprint);
            const createPayloadHash = hashObject(payload);
            const recoveryBindingHash = hashObject(x402RecoveryBinding(intent));
            const existing = secret.x402Effects[slot];
            if (existing !== undefined) {
                if (existing.createPayloadHash !== createPayloadHash || existing.recoveryBindingHash !== recoveryBindingHash) {
                    throw rejected("APN_X402_AUTHORIZATION_MISMATCH", "Stored x402 authorization differs from the frozen request.");
                }
                ensureX402Live(intent.authorization.validBefore);
                return publicX402Effect(existing);
            }
            const account = privateKeyToAccount(secret.privateKey);
            const signature = await account.signTypedData({
                domain: {
                    name: intent.tokenDomain.name,
                    version: intent.tokenDomain.version,
                    chainId: Number(intent.chainId),
                    verifyingContract: intent.token,
                },
                types: {
                    TransferWithAuthorization: [
                        { name: "from", type: "address" }, { name: "to", type: "address" },
                        { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
                        { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
                    ],
                },
                primaryType: "TransferWithAuthorization",
                message: {
                    from: intent.authorization.from,
                    to: intent.authorization.to,
                    value: BigInt(intent.authorization.value),
                    validAfter: 0n,
                    validBefore: BigInt(intent.authorization.validBefore),
                    nonce: intent.authorization.nonce,
                },
            });
            const authorization = publicAuthorization(intent.authorization);
            const effect = {
                createPayloadHash,
                recoveryBindingHash,
                authorization,
                signature,
                signatureHash: domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")),
            };
            secret.x402Effects[slot] = effect;
            await this.wallets.save(identity, secret);
            return publicX402Effect(effect);
        });
    }
    async getX402(payload) {
        const recovery = parseX402Recovery(payload);
        return await this.withWallet(recovery.profile, async (identity, secret) => {
            assertWallet(identity, recovery.wallet);
            const slot = effectSlot("apn-x402-effect-v1", recovery.profile, recovery.operationId, recovery.fingerprint);
            const effect = secret.x402Effects[slot];
            if (effect === undefined)
                throw rejected("APN_X402_AUTHORIZATION_NOT_FOUND", "x402 authorization material was not found.");
            const expectedHash = hashObject(x402RecoveryBinding(recovery));
            if (effect.recoveryBindingHash !== expectedHash || (recovery.expectedSignatureHash !== undefined && effect.signatureHash !== recovery.expectedSignatureHash)) {
                throw rejected("APN_X402_AUTHORIZATION_MISMATCH", "x402 recovery binding does not match.");
            }
            ensureX402Live(recovery.authorization.validBefore);
            return publicX402Effect(effect);
        });
    }
    async withWallet(profile, action) {
        const loaded = await this.wallets.describe(profile);
        if (loaded === null)
            throw rejected("APN_WALLET_NOT_FOUND", "Wallet is not initialized.");
        try {
            return await action(loaded.identity, loaded.secret);
        }
        finally {
            this.wallets.clear(loaded.secret);
        }
    }
}
_a = LocalWalletNative;
function assertWallet(identity, expected) {
    if (!addressEqual(identity.address, expected))
        throw rejected("APN_WALLET_MISMATCH", "Wallet identity differs from the frozen payment.");
}
function ensureX402Live(validBefore) {
    if (BigInt(Math.floor(Date.now() / 1000)) >= BigInt(validBefore))
        throw rejected("APN_APPROVAL_EXPIRED", "x402 authorization is expired.");
}
function effectSlot(domain, profile, operationId, fingerprint) {
    return sha256(`${domain}\0${profile}\0${operationId}\0${fingerprint}`);
}
function requestProfile(payload) {
    return canonicalProfile(payload.profile);
}
function exactRecord(value, keys) {
    if (!isPlainRecord(value) || !exactKeys(value, keys))
        throw protocol("Custody request violates the exact schema.");
    return value;
}
function addressEqual(left, right) { return left.toLowerCase() === right.toLowerCase(); }
function x402Address(value, label) {
    if (typeof value !== "string")
        throw protocol(`Invalid x402 ${label}.`);
    canonicalAddress(value);
    if (value !== value.toLowerCase())
        throw protocol(`x402 ${label} must be normalized lowercase.`);
    return value;
}
function protocol(message) { return new ApnError("APN_NATIVE_PROTOCOL", message); }
function rejected(nativeCode, message) {
    return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode });
}
//# sourceMappingURL=local-wallet-native.js.map