import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domainHash, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { APPROVAL_WINDOW_MS, BASE_USDC, CHAIN_ID } from "./constants.js";
import { EncryptedWalletStore, } from "./encrypted-wallet-store.js";
import { ApnError } from "./errors.js";
import { formatAtomic } from "./money.js";
import { transferData } from "./transfer-policy.js";
import { TtyTransferApproval } from "./tty-approval.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
import { x402AuthorizationIntentHash } from "./x402-state-integrity.js";
const HASH = /^[a-f0-9]{64}$/u;
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const NONCE = /^0x[0-9a-fA-F]{64}$/u;
export class LocalWalletNative {
    state;
    approval;
    wallets;
    constructor(state, wrappingSecret, approval = new TtyTransferApproval()) {
        this.state = state;
        this.approval = approval;
        this.wallets = new EncryptedWalletStore(state, wrappingSecret);
    }
    async request(request) {
        if (request.version !== "apn.native.v1")
            throw protocol("Unsupported custody request version.");
        await this.state.initialize();
        const profile = requestProfile(request.payload);
        const profileHash = this.state.profileHash(profile);
        return await this.state.withLocks([`custody:${profileHash}`], async () => {
            switch (request.operation) {
                case "wallet.ensure": return await this.ensureWallet(profile);
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
        const intent = parseDirectIntent(payload);
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
            const account = privateKeyToAccount(secret.privateKey);
            const rawTransaction = await account.signTransaction({
                type: "eip1559",
                chainId: CHAIN_ID,
                to: BASE_USDC,
                value: 0n,
                data: intent.transactionData,
                nonce: Number(BigInt(intent.nonceAtomic)),
                gas: BigInt(intent.gasLimitAtomic),
                maxFeePerGas: BigInt(intent.maxFeePerGasAtomic),
                maxPriorityFeePerGas: BigInt(intent.maxPriorityFeePerGasAtomic),
                accessList: [],
            });
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
            if (effect === undefined)
                throw rejected("APN_EFFECT_NOT_FOUND", "Direct-transfer effect material was not found.");
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
                    chainId: CHAIN_ID,
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
function parseDirectIntent(payload) {
    exactRecord(payload, ["profile", "operationId", "fingerprint", "walletAddress", "chainId", "transaction", "approval"]);
    const profile = canonicalProfile(payload.profile);
    const operationId = hash(payload.operationId, "operation ID");
    const fingerprint = hash(payload.fingerprint, "fingerprint");
    const walletAddress = canonicalAddress(payload.walletAddress);
    if (payload.chainId !== CHAIN_ID)
        throw protocol("Direct-transfer chain is unsupported.");
    const transaction = exactRecord(payload.transaction, ["type", "to", "valueAtomic", "data", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "accessList"]);
    const approval = exactRecord(payload.approval, ["recipient", "amountAtomic", "amountDecimal", "expiresAt"]);
    if (transaction.type !== "eip1559" || transaction.to !== BASE_USDC || transaction.valueAtomic !== "0" || !Array.isArray(transaction.accessList) || transaction.accessList.length !== 0)
        throw protocol("Direct-transfer transaction is not bounded Base USDC.");
    const recipient = canonicalAddress(approval.recipient);
    const amountAtomic = decimal(approval.amountAtomic, "amount", true);
    if (approval.amountDecimal !== formatAtomic(amountAtomic, 6))
        throw protocol("Direct-transfer decimal amount is inconsistent.");
    if (typeof transaction.data !== "string" || !HEX.test(transaction.data) || transaction.data.toLowerCase() !== transferData(recipient, amountAtomic).toLowerCase())
        throw protocol("Direct-transfer calldata is invalid.");
    const nonceAtomic = decimal(transaction.nonceAtomic, "nonce");
    const gasLimitAtomic = decimal(transaction.gasLimitAtomic, "gas limit", true);
    const maxFeePerGasAtomic = decimal(transaction.maxFeePerGasAtomic, "maximum fee", true);
    const maxPriorityFeePerGasAtomic = decimal(transaction.maxPriorityFeePerGasAtomic, "priority fee");
    const nonce = BigInt(nonceAtomic);
    const gas = BigInt(gasLimitAtomic);
    const fee = BigInt(maxFeePerGasAtomic);
    const priority = BigInt(maxPriorityFeePerGasAtomic);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || gas < 21000n || gas > 200000n || fee > 1000000000000n || priority > fee)
        throw protocol("Direct-transfer economics exceed the custody boundary.");
    if (typeof approval.expiresAt !== "string" || !Number.isFinite(Date.parse(approval.expiresAt)))
        throw protocol("Direct-transfer expiry is invalid.");
    const expiresAt = approval.expiresAt;
    const preparedAt = new Date(Date.parse(expiresAt) - APPROVAL_WINDOW_MS).toISOString();
    const expectedFingerprint = hashObject({
        method: "pay.transfer", operationId, profile, chainId: CHAIN_ID, token: BASE_USDC,
        walletAddress, recipient, amountAtomic, transactionData: transaction.data,
        economics: {
            nonceAtomic, gasLimitAtomic, maxFeePerGasAtomic, maxPriorityFeePerGasAtomic,
            maximumGasCostAtomic: (gas * fee).toString(),
        },
        preparedAt,
        expiresAt,
    });
    if (expectedFingerprint !== fingerprint || Date.now() >= Date.parse(expiresAt))
        throw rejected("APN_APPROVAL_EXPIRED", "Direct-transfer approval is invalid or expired.");
    return {
        profile, operationId, fingerprint, walletAddress, recipient, amountAtomic,
        amountDecimal: approval.amountDecimal, nonceAtomic, gasLimitAtomic,
        maxFeePerGasAtomic, maxPriorityFeePerGasAtomic, expiresAt, transactionData: transaction.data,
    };
}
function parseDirectRecovery(payload) {
    exactRecord(payload, ["profile", "operationId", "fingerprint", "expectedTransactionHash", "expectedRawTransactionHash"]);
    return {
        profile: canonicalProfile(payload.profile),
        operationId: hash(payload.operationId, "operation ID"),
        fingerprint: hash(payload.fingerprint, "fingerprint"),
        expectedTransactionHash: hex32(payload.expectedTransactionHash, "transaction hash"),
        expectedRawTransactionHash: hex32(payload.expectedRawTransactionHash, "raw transaction hash"),
    };
}
function parseX402Create(payload) {
    const baseKeys = ["profile", "operationId", "fingerprint", "wallet", "chainId", "token", "resource", "capAtomic", "payee", "amountAtomic", "tokenDomain", "authorization", "paymentIdentifierPosture", "offerHash", "intentHash"];
    const posture = payload.paymentIdentifierPosture;
    exactRecord(payload, posture === "absent" ? baseKeys : [...baseKeys, "paymentIdentifierValue"]);
    const common = parseX402Common(payload, true);
    const resource = exactRecord(payload.resource, ["origin", "path", "urlHash"]);
    if (typeof resource.origin !== "string" || typeof resource.path !== "string" || typeof resource.urlHash !== "string" || !HASH.test(resource.urlHash))
        throw protocol("x402 resource binding is invalid.");
    if (!HASH.test(String(payload.offerHash)) || !["absent", "optional", "required"].includes(String(posture)))
        throw protocol("x402 offer binding is invalid.");
    if (posture !== "absent" && (typeof payload.paymentIdentifierValue !== "string" || payload.paymentIdentifierValue.length === 0))
        throw protocol("x402 payment identifier is invalid.");
    const payee = x402Address(payload.payee, "payee");
    const amountAtomic = decimal(payload.amountAtomic, "x402 amount", true);
    const capAtomic = decimal(payload.capAtomic, "x402 cap", true);
    if (BigInt(amountAtomic) > BigInt(capAtomic) || !addressEqual(payee, common.authorization.to) || common.authorization.value !== amountAtomic)
        throw protocol("x402 economics are invalid.");
    const rawAuthorization = exactRecord(payload.authorization, ["from", "to", "value", "validAfter", "validBefore", "nonce", "createdAt"]);
    const createdAt = decimal(rawAuthorization.createdAt, "x402 creation time");
    const authorization = { ...common.authorization, createdAt };
    const created = BigInt(createdAt);
    const validBefore = BigInt(authorization.validBefore);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (created > now || validBefore <= now || validBefore - created < 30n || validBefore - created > 300n)
        throw rejected("APN_APPROVAL_EXPIRED", "x402 authorization window is invalid or expired.");
    if (common.intentHash !== x402AuthorizationIntentHash(authorization))
        throw protocol("x402 authorization intent hash is invalid.");
    return { ...common, payee, amountAtomic, capAtomic, authorization };
}
function parseX402Recovery(payload) {
    const allowed = ["profile", "operationId", "fingerprint", "wallet", "chainId", "token", "tokenDomain", "authorization", "intentHash"];
    exactRecord(payload, payload.expectedSignatureHash === undefined ? allowed : [...allowed, "expectedSignatureHash"]);
    const common = parseX402Common(payload, false);
    if (payload.expectedSignatureHash !== undefined && (typeof payload.expectedSignatureHash !== "string" || !HASH.test(payload.expectedSignatureHash)))
        throw protocol("x402 expected signature hash is invalid.");
    return { ...common, ...(payload.expectedSignatureHash === undefined ? {} : { expectedSignatureHash: payload.expectedSignatureHash }) };
}
function parseX402Common(payload, create) {
    const profile = canonicalProfile(payload.profile);
    const operationId = hash(payload.operationId, "operation ID");
    const fingerprint = hash(payload.fingerprint, "fingerprint");
    const wallet = x402Address(payload.wallet, "wallet");
    if (payload.chainId !== "8453")
        throw protocol("x402 chain is unsupported.");
    const token = x402Address(payload.token, "token");
    if (!addressEqual(token, BASE_USDC))
        throw protocol("x402 token is unsupported.");
    const tokenDomain = exactRecord(payload.tokenDomain, ["name", "version"]);
    if (typeof tokenDomain.name !== "string" || tokenDomain.name.length === 0 || typeof tokenDomain.version !== "string" || tokenDomain.version.length === 0)
        throw protocol("x402 token domain is invalid.");
    const authKeys = create ? ["from", "to", "value", "validAfter", "validBefore", "nonce", "createdAt"] : ["from", "to", "value", "validAfter", "validBefore", "nonce"];
    const authorization = exactRecord(payload.authorization, authKeys);
    const from = x402Address(authorization.from, "authorization sender");
    const to = x402Address(authorization.to, "authorization recipient");
    const value = decimal(authorization.value, "x402 value", true);
    const validBefore = decimal(authorization.validBefore, "x402 expiry", true);
    const nonce = hex32(authorization.nonce, "x402 nonce");
    if (!addressEqual(wallet, from) || authorization.validAfter !== "0")
        throw protocol("x402 authorization binding is invalid.");
    const intentHash = hash(payload.intentHash, "x402 intent hash");
    return {
        profile, operationId, fingerprint, wallet, chainId: "8453", token,
        tokenDomain: { name: tokenDomain.name, version: tokenDomain.version },
        authorization: { from, to, value, validAfter: "0", validBefore, nonce },
        intentHash,
    };
}
function x402RecoveryBinding(value) {
    return {
        profile: value.profile, operationId: value.operationId, fingerprint: value.fingerprint,
        wallet: value.wallet, chainId: value.chainId, token: value.token, tokenDomain: value.tokenDomain,
        authorization: publicAuthorization(value.authorization), intentHash: value.intentHash,
    };
}
function publicAuthorization(value) {
    return {
        from: value.from, to: value.to, value: value.value, validAfter: value.validAfter,
        validBefore: value.validBefore, nonce: value.nonce,
    };
}
function publicIdentity(identity) {
    return { profile: identity.profile, address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash };
}
function publicDirectEffect(effect) {
    return { transactionHash: effect.transactionHash, rawTransaction: effect.rawTransaction, rawTransactionHash: effect.rawTransactionHash };
}
function publicX402Effect(effect) {
    return { authorization: effect.authorization, signature: effect.signature, signatureHash: effect.signatureHash };
}
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
function decimal(value, label, positive = false) {
    if (typeof value !== "string" || !DECIMAL.test(value) || (positive && value === "0"))
        throw protocol(`Invalid ${label}.`);
    return value;
}
function hash(value, label) {
    if (typeof value !== "string" || !HASH.test(value))
        throw protocol(`Invalid ${label}.`);
    return value;
}
function hex32(value, label) {
    if (typeof value !== "string" || !NONCE.test(value))
        throw protocol(`Invalid ${label}.`);
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