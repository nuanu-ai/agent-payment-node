import { MerchantClaims } from "./claims.js";
import { assertMerchantAuthority } from "./authority.js";
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { parseTransaction, recoverTransactionAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { SecureStateStore } from "../secure-state-store.js";
import { MERCHANT_OWNER, MERCHANT_TOKEN } from "./pins.js";
import { MERCHANT_DATA } from "./rpc.js";
import { refuse } from "./protocol.js";
export async function verifyMerchantRaw(o, raw) {
    const tx = parseTransaction(raw), owner = await recoverTransactionAddress({ serializedTransaction: raw }), e = o.envelope;
    if (owner !== MERCHANT_OWNER || tx.type !== "eip1559" || tx.chainId !== 4326 || tx.to?.toLowerCase() !== MERCHANT_TOKEN.toLowerCase() || tx.data !== MERCHANT_DATA || tx.value !== 0n ||
        tx.nonce !== Number(e.nonce) || tx.gas !== BigInt(e.gas) || tx.maxFeePerGas !== BigInt(e.maxFeePerGas) || tx.maxPriorityFeePerGas !== BigInt(e.maxPriorityFeePerGas) || tx.accessList?.length !== 0)
        refuse("merchant_signed_transaction_binding");
    return keccak256(raw);
}
export class MerchantCustody extends SecureStateStore {
    state;
    wrapping;
    now;
    wallets;
    constructor(state, wrapping, now) {
        super(state.root);
        this.state = state;
        this.wrapping = wrapping;
        this.now = now;
        this.wallets = new EncryptedWalletStore(state, wrapping);
    }
    async verify(o, raw) { return await verifyMerchantRaw(o, raw); }
    async sign(o, grant, controller) {
        assertMerchantAuthority(grant, controller, o, this.now());
        if (o.state !== "signing_started" || o.signingAttempts !== 1 || o.submissionAttempts !== 0 || this.now().toISOString() >= o.expiresAt)
            refuse("merchant_signing_gate");
        await new MerchantClaims(this.state.root).requireSign(o);
        assertMerchantAuthority(grant, controller, o, this.now(), "sign");
        return this.state.withLocks([`custody:${o.profileHash}`], async () => {
            assertMerchantAuthority(grant, controller, o, this.now());
            const w = await this.wallets.describe(o.profile, () => assertMerchantAuthority(grant, controller, o, this.now()), async (identity) => { assertMerchantAuthority(grant, controller, o, this.now()); await assertEvmNativeCustody(this.state, o.profile, o.custody, identity); assertMerchantAuthority(grant, controller, o, this.now()); });
            if (w === null)
                refuse("merchant_encrypted_wallet_missing");
            try {
                assertMerchantAuthority(grant, controller, o, this.now());
                await assertEvmNativeCustody(this.state, o.profile, o.custody, w.identity);
                assertMerchantAuthority(grant, controller, o, this.now());
                const a = privateKeyToAccount(w.secret.privateKey);
                if (a.address !== MERCHANT_OWNER || this.now().toISOString() >= o.expiresAt)
                    refuse("merchant_signing_identity_or_expiry");
                const e = o.envelope;
                assertMerchantAuthority(grant, controller, o, this.now());
                return await a.signTransaction({ type: "eip1559", chainId: 4326, to: MERCHANT_TOKEN, data: MERCHANT_DATA, value: 0n, nonce: Number(e.nonce), gas: BigInt(e.gas), maxFeePerGas: BigInt(e.maxFeePerGas), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGas), accessList: [] });
            }
            finally {
                this.wallets.clear(w.secret);
            }
        });
    }
    /** Create-only authenticated encryption. Public journal contains only the hash and once-only attempt fence. */
    async seal(o, raw) {
        const txHash = await verifyMerchantRaw(o, raw), secret = await this.wrapping.load();
        if (secret === null)
            refuse("merchant_wrapping_secret_missing");
        const salt = randomBytes(32), nonce = randomBytes(12), binding = { schemaVersion: "apn.merchant-material.v1", operationId: o.operationId, profileHash: o.profileHash, fingerprint: o.fingerprint, txHash };
        const key = Buffer.from(hkdfSync("sha256", secret, salt, Buffer.from(canonicalJson(binding)), 32)), plain = Buffer.from(raw, "ascii");
        try {
            const cipher = createCipheriv("aes-256-gcm", key, nonce);
            cipher.setAAD(Buffer.from(canonicalJson(binding)));
            const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
            await this.initialize();
            await this.ensureDirectory("merchant-material");
            await this.writeJson(`merchant-material/${o.operationId}.json`, { ...binding, salt: salt.toString("base64"), nonce: nonce.toString("base64"), ciphertext: encrypted.toString("base64"), tag: cipher.getAuthTag().toString("base64"), materialHash: hashObject({ txHash, fingerprint: o.fingerprint }) }, true);
            encrypted.fill(0);
        }
        finally {
            secret.fill(0);
            salt.fill(0);
            nonce.fill(0);
            key.fill(0);
            plain.fill(0);
        }
    }
}
//# sourceMappingURL=custody.js.map