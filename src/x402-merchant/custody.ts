import { MerchantClaims } from "./claims.js";
import { assertMerchantAuthority, type MerchantAuthority } from "./authority.js";
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { parseTransaction, recoverTransactionAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import type { MerchantOperation } from "./model.js";
import { MERCHANT_OWNER, MERCHANT_TOKEN } from "./pins.js";
import { MERCHANT_DATA } from "./rpc.js";
import { refuse } from "./protocol.js";
export interface MerchantCustodyPort {
    verify(o: MerchantOperation, raw: Hex): Promise<Hex>;
    sign(o: MerchantOperation, grant: MerchantAuthority, controller:object,beforeSign?:()=>Promise<void>): Promise<Hex>;
    seal(o: MerchantOperation, raw: Hex): Promise<void>;
}
export async function verifyMerchantRaw(o: MerchantOperation, raw: Hex) {
    const tx = parseTransaction(raw), owner = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` }), e = o.envelope;
    // viem omits canonical RLP zero values and the empty access list.
    const value = tx.value === undefined ? 0n : tx.value;
    const priority = tx.maxPriorityFeePerGas === undefined ? 0n : tx.maxPriorityFeePerGas;
    const accessList = tx.accessList === undefined ? [] : tx.accessList;
    if (owner !== MERCHANT_OWNER || tx.type !== "eip1559" || tx.chainId !== 4326 || tx.to?.toLowerCase() !== MERCHANT_TOKEN.toLowerCase() || tx.data !== MERCHANT_DATA || value !== 0n ||
        tx.nonce !== Number(e.nonce) || tx.gas !== BigInt(e.gas) || tx.maxFeePerGas !== BigInt(e.maxFeePerGas) || priority !== BigInt(e.maxPriorityFeePerGas) || !Array.isArray(accessList) || accessList.length !== 0)
        refuse("merchant_signed_transaction_binding");
    return keccak256(raw);
}
export class MerchantCustody extends SecureStateStore implements MerchantCustodyPort {
    private readonly wallets: EncryptedWalletStore;
    constructor(private readonly state: StateStore, private readonly wrapping: WrappingSecretPort, private readonly now: () => Date) { super(state.root); this.wallets = new EncryptedWalletStore(state, wrapping); }
    async verify(o: MerchantOperation, raw: Hex) { return await verifyMerchantRaw(o, raw); }
    async sign(o: MerchantOperation, grant: MerchantAuthority, controller:object,beforeSign?:()=>Promise<void>): Promise<Hex> {
        assertMerchantAuthority(grant,controller,o,this.now());
        if (o.state !== "signing_started" || o.signingAttempts !== 1 || o.submissionAttempts !== 0 || this.now().toISOString() >= o.expiresAt)
            refuse("merchant_signing_gate");
        await new MerchantClaims(this.state.root).requireSign(o);
        assertMerchantAuthority(grant,controller,o,this.now(),"sign");
        return this.state.withLocks([`custody:${o.profileHash}`], async () => {
            assertMerchantAuthority(grant,controller,o,this.now());
            const w = await this.wallets.describe(o.profile, () => assertMerchantAuthority(grant,controller,o,this.now()), async identity => { assertMerchantAuthority(grant,controller,o,this.now()); await assertEvmNativeCustody(this.state,o.profile,o.custody,identity); assertMerchantAuthority(grant,controller,o,this.now()); });
            if (w === null)
                refuse("merchant_encrypted_wallet_missing");
            try {
                assertMerchantAuthority(grant,controller,o,this.now());
                await assertEvmNativeCustody(this.state, o.profile, o.custody, w.identity);
                assertMerchantAuthority(grant,controller,o,this.now());
                if(o.feeContext!==undefined){if(beforeSign===undefined)refuse("merchant_fee_sign_guard_required");await beforeSign();assertMerchantAuthority(grant,controller,o,this.now());}
                const a = privateKeyToAccount(w.secret.privateKey);
                if (a.address !== MERCHANT_OWNER || this.now().toISOString() >= o.expiresAt)
                    refuse("merchant_signing_identity_or_expiry");
                const e = o.envelope;
                assertMerchantAuthority(grant,controller,o,this.now());
                return await a.signTransaction({ type: "eip1559", chainId: 4326, to: MERCHANT_TOKEN, data: MERCHANT_DATA, value: 0n, nonce: Number(e.nonce), gas: BigInt(e.gas), maxFeePerGas: BigInt(e.maxFeePerGas), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGas), accessList: [] });
            }
            finally {
                this.wallets.clear(w.secret);
            }
        });
    }
    /** Create-only authenticated encryption. Public journal contains only the hash and once-only attempt fence. */
    async seal(o: MerchantOperation, raw: Hex): Promise<void> {
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
