import { numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAuthorizationAddress } from "viem/utils";
import { recoverTypedDataAddress } from "viem";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { EncryptedWalletStore, walletCustodyLock } from "../encrypted-wallet-store.js";
import { UsdtBoundOperationRepository, validateUsdtBoundOperation } from "./bound-operation.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
import { validateUsdtPaymasterData } from "./paymaster-data.js";
import { usdtUserOperationHash, usdtUserOperationTypedData } from "./userop.js";
/** Local custody only. The signed wire is returned to the caller; no journal or transport is touched. */
export class LocalUsdtSigningService {
    state;
    now;
    wallets;
    constructor(state, wrapping, now = () => new Date()) {
        this.state = state;
        this.now = now;
        this.wallets = new EncryptedWalletStore(state, wrapping);
    }
    async sign(value, expected) {
        const bound = validateUsdtBoundOperation(value);
        assertIdentity(bound, expected);
        return await this.state.withLocks([walletCustodyLock(this.state, expected.profile)], async () => {
            const saved = await new UsdtBoundOperationRepository(this.state.root).load(expected.profileHash, expected.operationId);
            if (saved === null || canonicalJson(saved) !== canonicalJson(bound)) {
                usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_saved_binding_mismatch");
            }
            assertReady(bound, this.now());
            const wallet = await this.wallets.describe(expected.profile);
            if (wallet === null)
                usdtFailure("APN_WALLET_MISMATCH", "gasless_usdt_wallet_missing");
            try {
                if (wallet.identity.profile !== expected.profile || wallet.identity.address !== bound.binding.plan.request.sender) {
                    usdtFailure("APN_WALLET_MISMATCH", "gasless_usdt_wallet_identity");
                }
                let account;
                try {
                    account = privateKeyToAccount(wallet.secret.privateKey);
                }
                catch {
                    usdtFailure("APN_WALLET_MISMATCH", "gasless_usdt_wallet_key");
                }
                if (account.address !== wallet.identity.address)
                    usdtFailure("APN_WALLET_MISMATCH", "gasless_usdt_wallet_key");
                assertReady(bound, this.now());
                const saved = bound.binding, unsigned = saved.unsignedOperation;
                let authorization = undefined;
                if (saved.account.delegation === "empty") {
                    const nonce = BigInt(saved.account.eoaNonce);
                    if (nonce > BigInt(Number.MAX_SAFE_INTEGER))
                        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_authorization_nonce");
                    let signed;
                    try {
                        signed = await account.signAuthorization({ chainId: USDT_GASLESS.chainId,
                            address: USDT_GASLESS.delegate, nonce: Number(nonce) });
                    }
                    catch {
                        usdtFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_usdt_authorization_signing");
                    }
                    if (signed.yParity === undefined)
                        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_authorization_parity");
                    authorization = { chainId: numberToHex(signed.chainId), address: signed.address,
                        nonce: numberToHex(signed.nonce), yParity: numberToHex(signed.yParity), r: signed.r, s: signed.s };
                }
                const draft = { ...unsigned, signature: "0x", ...(authorization === undefined ? {} : { eip7702Auth: authorization }) };
                let signature;
                try {
                    signature = await account.signTypedData(usdtUserOperationTypedData(draft));
                }
                catch {
                    usdtFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_usdt_user_operation_signing");
                }
                const userOperation = { ...draft, signature };
                const userOperationHash = await verifySignedUsdtOperation(bound, userOperation);
                const body = { schemaVersion: "apn.gasless-usdt-local-signature.v1",
                    operationId: bound.operationId, profileHash: bound.profileHash, bindingHash: saved.bindingHash,
                    userOperation, userOperationHash };
                return Object.freeze({ ...body, materialHash: hashObject(body) });
            }
            finally {
                this.wallets.clear(wallet.secret);
            }
        });
    }
}
/** Independent local check for a returned wire. The prepared calldata, fees and paymaster bytes are immutable. */
export async function verifySignedUsdtOperation(boundValue, wire) {
    const bound = validateUsdtBoundOperation(boundValue), saved = bound.binding, expected = saved.unsignedOperation;
    const { signature: _placeholder, eip7702Auth: _stub, ...expectedBody } = expected;
    const { signature, eip7702Auth, ...wireBody } = wire;
    if (hashObject(expectedBody) !== hashObject(wireBody) || !/^0x[0-9a-f]{130}$/u.test(signature)) {
        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_signed_wire_binding");
    }
    if ((saved.account.delegation === "empty") !== (eip7702Auth !== undefined)) {
        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_signed_delegation");
    }
    if (eip7702Auth !== undefined) {
        if (eip7702Auth.chainId !== "0x1" || eip7702Auth.address !== USDT_GASLESS.delegate ||
            eip7702Auth.nonce !== numberToHex(BigInt(saved.account.eoaNonce)) ||
            !["0x0", "0x1"].includes(eip7702Auth.yParity)) {
            usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_signed_authorization_binding");
        }
        let signer;
        try {
            signer = await recoverAuthorizationAddress({ authorization: { chainId: 1,
                    address: eip7702Auth.address, nonce: Number(BigInt(eip7702Auth.nonce)),
                    yParity: Number(BigInt(eip7702Auth.yParity)), r: eip7702Auth.r, s: eip7702Auth.s } });
        }
        catch {
            usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_signed_authorization");
        }
        if (signer !== saved.plan.request.sender)
            usdtFailure("APN_WALLET_MISMATCH", "gasless_usdt_signed_authorization_owner");
    }
    let signer;
    try {
        signer = await recoverTypedDataAddress({ ...usdtUserOperationTypedData(wire), signature });
    }
    catch {
        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_signed_signature");
    }
    if (signer !== saved.plan.request.sender)
        usdtFailure("APN_WALLET_MISMATCH", "gasless_usdt_signed_owner");
    try {
        return usdtUserOperationHash(wire);
    }
    catch {
        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_signed_hash");
    }
}
function assertIdentity(bound, expected) {
    if (expected.profile !== bound.binding.profile || expected.profileHash !== bound.profileHash ||
        expected.profileHash !== allowlistProfileHash(expected.profile) || expected.operationId !== bound.operationId ||
        expected.bindingHash !== bound.binding.bindingHash) {
        usdtFailure("APN_WALLET_MISMATCH", "gasless_usdt_signing_identity");
    }
}
function assertReady(bound, at) {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
    const b = bound.binding, nowSeconds = BigInt(Math.floor(at.getTime() / 1000));
    if (b.chain !== USDT_GASLESS.chain || b.unsignedOperation.paymaster !== USDT_GASLESS.paymaster ||
        b.plan.request.sender !== b.unsignedOperation.sender ||
        b.unsignedOperation.nonce !== numberToHex(BigInt(b.account.entryPointNonce)) ||
        BigInt(b.plan.feeCapAtomic) !== BigInt(b.plan.request.maxFeeAtomic) ||
        BigInt(b.plan.quotedFeeAtomic) > BigInt(b.plan.feeCapAtomic)) {
        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_signing_binding");
    }
    const unpack = (value, names) => {
        const copy = { ...value };
        for (const name of names)
            copy[name] = BigInt(value[name]);
        return copy;
    };
    const restored = { ...b.plan, request: unpack(b.plan.request, ["grossAtomic", "maxFeeAtomic", "minReceivedAtomic"]),
        quote: unpack(b.plan.quote, ["postOpGas", "exchangeRate", "exchangeRateNativeToUsd"]),
        price: unpack(b.plan.price, ["maxFeePerGas", "maxPriorityFeePerGas"]),
        gas: unpack(b.plan.gas, Object.keys(b.plan.gas)),
        feeCapAtomic: BigInt(b.plan.feeCapAtomic), netAtomic: BigInt(b.plan.netAtomic),
        quotedFeeAtomic: BigInt(b.plan.quotedFeeAtomic) };
    try {
        validateUsdtPaymasterData({ paymaster: USDT_GASLESS.paymaster, paymasterData: b.paymasterData }, restored, nowSeconds);
    }
    catch {
        usdtFailure("APN_REPREPARE_REQUIRED", "gasless_usdt_quote_expired_or_changed");
    }
}
//# sourceMappingURL=local-signing.js.map