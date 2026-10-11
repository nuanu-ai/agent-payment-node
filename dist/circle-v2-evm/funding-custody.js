import { CircleFundingExternalStore } from "./funding-external-store.js";
import { assertCircleFundingRuntimeAuthority } from "./funding-runtime.js";
import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateCircleFundingOperation as validateCircle } from "./funding-operation.js";
import { assertCircleFundingEffectGuard, snapshotCircleFundingOperation, snapshotCircleFundingEffect } from "./funding-lifecycle.js";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked, circleCorrupt, circleSame } from "./operation-model.js";
const VERSION = "apn.circle-v2-evm-effect-envelope.v2";
export class CircleFundingEffectStore extends SecureStateStore {
    wrapping;
    constructor(root, wrapping) {
        super(root);
        this.wrapping = wrapping;
    }
    path(op, role) { validateCircle(op); return `circle-v2-evm-funding-effects/${op.operationId}-${role}.json`; }
    /** Presence-only refusal; this never decrypts material or loads a wrapping secret. */
    async assertExternalAbsent(op) {
        validateCircle(op);
        for (const role of ["mint", "cleanup"])
            for (const suffix of ["", "-sign", "-send"])
                if (await this.readJson(`circle-v2-evm-funding-effects/${op.operationId}-${role}${suffix}.json`) !== null)
                    circleBlocked("external_owned_private_entry");
    }
    async load(op, effect, guard) {
        const value = await this.readJson(this.path(op, effect.role));
        if (value === null)
            return null;
        if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "salt", "nonce", "ciphertext", "tag"]))
            circleCorrupt("material_envelope");
        const e = value;
        if (e.schemaVersion !== VERSION || e.operationId !== op.operationId || e.role !== effect.role || e.fingerprint !== op.fingerprint || e.envelopeHash !== effect.envelope.envelopeHash)
            circleCorrupt("material_binding");
        const snapshot = await this.snapshot(op, effect);
        await this.sameSnapshot(op, effect, snapshot, value);
        guard?.();
        const wrapping = await this.wrapping.load();
        if (wrapping === null)
            circleBlocked("wrapping_secret_missing");
        let salt = Buffer.alloc(0), nonce = Buffer.alloc(0), ciphertext = Buffer.alloc(0), tag = Buffer.alloc(0), key = Buffer.alloc(0), plaintext = Buffer.alloc(0);
        try {
            guard?.();
            await this.sameSnapshot(op, effect, snapshot, value);
            salt = base64(e.salt, 32);
            nonce = base64(e.nonce, 12);
            ciphertext = base64(e.ciphertext);
            tag = base64(e.tag, 16);
            key = derive(wrapping, salt, e);
            const { ciphertext: _cipher, tag: _tag, ...header } = e, decipher = createDecipheriv("aes-256-gcm", key, nonce);
            decipher.setAAD(Buffer.from(canonicalJson(header)));
            decipher.setAuthTag(tag);
            plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), material = JSON.parse(text);
            if (canonicalJson(material) !== text)
                circleCorrupt("material_plaintext");
            await this.sameSnapshot(op, effect, snapshot, value);
            const verified = await verifyCircleFundingMaterial(op, effect, material);
            await this.sameSnapshot(op, effect, snapshot, value);
            return verified;
        }
        finally {
            wrapping.fill(0);
            salt.fill(0);
            nonce.fill(0);
            ciphertext.fill(0);
            tag.fill(0);
            key.fill(0);
            plaintext.fill(0);
        }
    }
    async claim(op, effect, kind, guard) {
        validateCircle(op);
        guard();
        if (effect.role === "mint" || effect.role === "cleanup")
            await new CircleFundingExternalStore(this.root).assertOwnedMintAvailable(op);
        guard();
        await this.initialize();
        await this.ensureDirectory("circle-v2-evm-funding-effects");
        guard();
        const path = `circle-v2-evm-funding-effects/${op.operationId}-${effect.role}-${kind}.json`;
        if (await this.readJson(path) !== null)
            circleBlocked("funding_effect_permanently_claimed");
        guard();
        const body = { schemaVersion: "apn.circle-v2-evm-effect-claim.v2", operationId: op.operationId, role: effect.role, kind, fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash };
        await this.writeJson(path, { ...body, claimHash: hashObject(body) }, true);
        guard();
    }
    async snapshot(op, effect) {
        const file = join(this.root, this.path(op, effect.role));
        const tuple = (x) => [x.dev, x.ino, x.uid, x.mode, x.nlink, x.size, x.mtimeMs, x.ctimeMs];
        return [tuple(await lstat(this.root)), tuple(await lstat(dirname(file))), tuple(await lstat(file))];
    }
    async sameSnapshot(op, effect, snapshot, value) {
        const current = await this.readJson(this.path(op, effect.role));
        if (!circleSame(value, current) || !circleSame(snapshot, await this.snapshot(op, effect)))
            circleCorrupt("material_snapshot_changed");
    }
    async save(op, effect, material, guard) {
        await verifyCircleFundingMaterial(op, effect, material);
        const existing = await this.load(op, effect, guard);
        if (existing !== null) {
            if (!circleSame(existing, material))
                circleCorrupt("material_replacement");
            return existing;
        }
        guard?.();
        const wrapping = await this.wrapping.load();
        if (wrapping === null)
            circleBlocked("wrapping_secret_missing");
        const salt = randomBytes(32), nonce = randomBytes(12), header = { schemaVersion: VERSION, operationId: op.operationId, role: effect.role,
            fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, salt: salt.toString("base64"), nonce: nonce.toString("base64") }, key = derive(wrapping, salt, header), plaintext = Buffer.from(canonicalJson(material));
        let ciphertext = Buffer.alloc(0);
        try {
            guard?.();
            const cipher = createCipheriv("aes-256-gcm", key, nonce);
            cipher.setAAD(Buffer.from(canonicalJson(header)));
            ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            await this.initialize();
            await this.ensureDirectory("circle-v2-evm-funding-effects");
            guard?.();
            await this.writeJson(this.path(op, effect.role), { ...header, ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") }, true);
            return material;
        }
        finally {
            wrapping.fill(0);
            salt.fill(0);
            nonce.fill(0);
            key.fill(0);
            plaintext.fill(0);
            ciphertext.fill(0);
        }
    }
}
export class LocalCircleFundingCustody {
    state;
    wallets;
    material;
    constructor(state, wrapping) {
        this.state = state;
        this.wallets = new EncryptedWalletStore(state, wrapping);
        this.material = new CircleFundingEffectStore(state.root, wrapping);
    }
    async load(op, effect) { return await this.material.load(op, effect); }
    async claimSend(op, effect, guard) {
        const gate = () => { assertCircleFundingEffectGuard(op, effect, guard); assertCircleFundingRuntimeAuthority(this.state, op, effect); };
        gate();
        if (effect.phase !== "submission_started")
            circleBlocked("funding_submission_gate");
        await this.material.claim(op, effect, "send", gate);
    }
    async seal(input, effectInput, guard) {
        const op = snapshotCircleFundingOperation(input), effect = snapshotCircleFundingEffect(op, effectInput);
        const gate = () => { assertCircleFundingEffectGuard(op, effect, guard); assertCircleFundingRuntimeAuthority(this.state, op, effect); };
        gate();
        if (effect.role === "mint" || effect.role === "cleanup")
            await new CircleFundingExternalStore(this.state.root).assertOwnedMintAvailable(op);
        gate();
        if (op.terminal || effect.phase !== "signing_started")
            circleBlocked("signing_gate");
        const destination = effect.role === "mint", profile = destination ? op.destinationProfile : op.profile, custody = destination ? op.destinationCustody : op.sourceCustody;
        return this.state.withLocks([`custody:${custody.profileHash}`], async () => {
            gate();
            await assertEvmNativeCustody(this.state, profile, custody);
            gate();
            const existing = await this.material.load(op, effect, gate);
            gate();
            if (existing !== null)
                return existing;
            await this.material.claim(op, effect, "sign", gate);
            gate();
            const wallet = await this.wallets.describe(profile, undefined, identity => { gate(); return assertEvmNativeCustody(this.state, profile, custody, identity); });
            if (wallet === null)
                circleBlocked("encrypted_wallet_missing");
            try {
                gate();
                const account = privateKeyToAccount(wallet.secret.privateKey);
                if (account.address !== custody.walletAddress)
                    circleBlocked("derived_owner_mismatch");
                gate();
                const e = effect.envelope, rawTransaction = await account.signTransaction({ type: "eip1559", chainId: e.chainId, to: e.to, data: e.data,
                    value: 0n, nonce: Number(e.nonceAtomic), gas: BigInt(e.gasLimitAtomic), maxFeePerGas: BigInt(e.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasAtomic), accessList: [] });
                gate();
                const body = { schemaVersion: "apn.circle-v2-evm-effect.v2", operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint,
                    envelopeHash: e.envelopeHash, rawTransaction, transactionHash: keccak256(rawTransaction) };
                return await this.material.save(op, effect, { ...body, materialHash: hashObject(body) }, gate);
            }
            finally {
                this.wallets.clear(wallet.secret);
            }
        });
    }
}
export async function verifyCircleFundingMaterial(op, effect, input) {
    if (!isPlainRecord(input) || !exactKeys(input, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "rawTransaction", "transactionHash", "materialHash"]))
        circleCorrupt("material_shape");
    const material = input, { materialHash, ...body } = material, e = effect.envelope;
    if (hashObject(body) !== materialHash || material.schemaVersion !== "apn.circle-v2-evm-effect.v2" || material.operationId !== op.operationId || material.role !== effect.role || material.fingerprint !== op.fingerprint || material.envelopeHash !== e.envelopeHash ||
        typeof material.rawTransaction !== "string" || !/^0x(?:[a-f0-9]{2})+$/u.test(material.rawTransaction) || material.rawTransaction.length > 32770 ||
        keccak256(material.rawTransaction) !== material.transactionHash || effect.transactionHash !== null && effect.transactionHash !== material.transactionHash || effect.materialHash !== null && effect.materialHash !== materialHash)
        circleCorrupt("material_identity");
    const t = parseTransaction(material.rawTransaction), from = getAddress(await recoverTransactionAddress({ serializedTransaction: material.rawTransaction }));
    if (t.type !== "eip1559" || t.chainId !== e.chainId || from !== e.from || t.to === undefined || t.to === null || getAddress(t.to) !== e.to || (t.data ?? "0x") !== e.data || (t.value ?? 0n) !== 0n ||
        String(t.nonce) !== e.nonceAtomic || String(t.gas) !== e.gasLimitAtomic || String(t.maxFeePerGas) !== e.maxFeePerGasAtomic || String(t.maxPriorityFeePerGas ?? 0n) !== e.maxPriorityFeePerGasAtomic ||
        (t.accessList ?? []).length !== 0 || t.r === undefined || t.s === undefined || BigInt(t.s) < 1n || BigInt(t.s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
        (t.yParity !== 0 && t.yParity !== 1) || serializeTransaction(t, { r: t.r, s: t.s, yParity: t.yParity }) !== material.rawTransaction)
        circleCorrupt("signed_transaction");
    return material;
}
function derive(wrapping, salt, h) { return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${VERSION}\0${h.operationId}\0${h.role}\0${h.fingerprint}\0${h.envelopeHash}`), 32)); }
function base64(input, length) { if (typeof input !== "string")
    circleCorrupt("material_encoding"); const b = Buffer.from(input, "base64"); if (b.length === 0 || b.length > 65536 || b.toString("base64") !== input || length !== undefined && b.length !== length)
    circleCorrupt("material_encoding"); return b; }
//# sourceMappingURL=funding-custody.js.map