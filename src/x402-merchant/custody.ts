import { MerchantClaims } from "./claims.js";
import { assertMerchantAuthority, type MerchantAuthority } from "./authority.js";
import { parseTransaction, recoverTransactionAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../canonical.js";
import { sealEnvelope, type EnvelopeSpec } from "../custody-envelope.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import type { MerchantOperation } from "./model.js";
import { merchantTransferData } from "./rpc.js";
import { merchantTerms } from "./terms.js";
import { refuse } from "./protocol.js";
export interface MerchantCustodyPort {
    verify(o: MerchantOperation, raw: Hex): Promise<Hex>;
    sign(o: MerchantOperation, grant: MerchantAuthority, controller:object,beforeSign?:()=>Promise<void>): Promise<Hex>;
    seal(o: MerchantOperation, raw: Hex): Promise<void>;
}
export async function verifyMerchantRaw(o: MerchantOperation, raw: Hex) {
    const tx = parseTransaction(raw), owner = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` }), e = o.envelope, t = merchantTerms(o);
    // viem omits canonical RLP zero values and the empty access list.
    const value = tx.value === undefined ? 0n : tx.value;
    const priority = tx.maxPriorityFeePerGas === undefined ? 0n : tx.maxPriorityFeePerGas;
    const accessList = tx.accessList === undefined ? [] : tx.accessList;
    if (owner !== t.payer || tx.type !== "eip1559" || tx.chainId !== 4326 || tx.to?.toLowerCase() !== t.token.toLowerCase() || tx.data !== merchantTransferData(t) || value !== 0n ||
        tx.nonce !== Number(e.nonce) || tx.gas !== BigInt(e.gas) || tx.maxFeePerGas !== BigInt(e.maxFeePerGas) || priority !== BigInt(e.maxPriorityFeePerGas) || !Array.isArray(accessList) || accessList.length !== 0)
        refuse("merchant_signed_transaction_binding");
    return keccak256(raw);
}
type MaterialBinding = { readonly schemaVersion: "apn.merchant-material.v1"; readonly operationId: string; readonly profileHash: string; readonly fingerprint: string; readonly txHash: Hex };
/** Seal-only: the binding is both the HKDF info and the AAD; the plaintext is the raw transaction's ASCII. */
const MATERIAL: Pick<EnvelopeSpec<MaterialBinding>, "info" | "aad"> = { info: binding => canonicalJson(binding), aad: binding => binding };
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
                const t = merchantTerms(o);
                if (a.address !== t.payer || this.now().toISOString() >= o.expiresAt)
                    refuse("merchant_signing_identity_or_expiry");
                const e = o.envelope;
                assertMerchantAuthority(grant,controller,o,this.now());
                return await a.signTransaction({ type: "eip1559", chainId: 4326, to: t.token as `0x${string}`, data: merchantTransferData(t), value: 0n, nonce: Number(e.nonce), gas: BigInt(e.gas), maxFeePerGas: BigInt(e.maxFeePerGas), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGas), accessList: [] });
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
        const binding: MaterialBinding = { schemaVersion: "apn.merchant-material.v1", operationId: o.operationId, profileHash: o.profileHash, fingerprint: o.fingerprint, txHash };
        try {
            const { header: _binding, ...sealed } = sealEnvelope(secret, MATERIAL, () => binding, Buffer.from(raw, "ascii"));
            await this.initialize();
            await this.ensureDirectory("merchant-material");
            await this.writeJson(`merchant-material/${o.operationId}.json`, { ...binding, ...sealed, materialHash: hashObject({ txHash, fingerprint: o.fingerprint }) }, true);
        }
        finally {
            secret.fill(0);
        }
    }
}
