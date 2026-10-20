import { assertFreshDirectEffect, publishDirectPublicEffect } from "./direct-public-attestation.js";
import { DirectPublicEffectJournal, directCustodyPayload } from "./direct-public-effect.js";
import type { Permit2ProductionSigningFence } from "./x402-permit2/production-signing-fence.js";
import type { Permit2ProductionJournal, Permit2SignedOrigin, Permit2SigningContinuation } from "./x402-permit2/production-journal.js";
import { reconstructPermit2ProductionMaterial } from "./x402-permit2/production-material.js";
import { createPermit2ProductionSigned } from "./x402-permit2/production-signed.js";
import { publicPermit2Production } from "./x402-permit2/production-repository.js";
import { assertPermit2ApprovalCurrent, assertPermit2ApprovalWindow, permit2Now } from "./x402-permit2/production-approval-provenance.js";
import type { Permit2ProductionRecord } from "./x402-permit2/production-repository.js";
import { parseDirectIntent, parseDirectRecovery } from "./local-wallet-direct-payload.js";
import { signedDirectTransaction } from "./local-wallet-direct-signed.js";
import { parseX402Create, parseX402Recovery, x402RecoveryBinding, publicAuthorization, type X402CustodyMethod } from "./local-wallet-native-x402-fields.js";
import { x402Eip2612TypedData, x402Permit2TypedData } from "./x402-permit2-exact.js";
import { assertWallet, ensureX402Live, effectSlot, requestProfile, protocol, rejected } from "./local-wallet-native-fields.js";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, normalize, parse, resolve, sep } from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domainHash, hashObject } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import {
  EncryptedWalletStore,
  walletEnvelopeIdentity,
  walletCustodyLock,
  type DirectEffectMaterial,
  type WalletIdentity,
  type WalletSecretState,
  type X402EffectMaterial,
} from "./encrypted-wallet-store.js";
import { ApnError } from "./errors.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "./evm-asset.js";
import { evmNativeCustody, assertEvmNativeCustody } from "./evm-native-custody.js";
import { parseEvmNativeIntent, snapshotEvmNativePayload } from "./evm-native-intent.js";
import type { Hex } from "./model.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { NativePort, NativeRequest } from "./ports.js";
import type { StateStore } from "./state.js";
import { TtyTransferApproval, type TransferApprovalPort } from "./tty-approval.js";
import { publicDirectEffect, publicWalletIdentity as publicIdentity, publicX402Effect } from "./local-wallet-native-public.js";
import { uniswapTokenNonceOwned } from "./swap/uniswap-v3/token-nonce-ownership.js";

export class LocalWalletNative implements NativePort {
  private readonly wallets: EncryptedWalletStore;
  /** The Permit2 signer's own state root and wallet store, fixed at construction. */
  readonly #permit2: { readonly root: string; readonly wallets: EncryptedWalletStore };
  constructor(
    private readonly state: StateStore,
    wrappingSecret: WrappingSecretPort,
    private readonly approval: TransferApprovalPort = new TtyTransferApproval(),
  ) {
    this.wallets = new EncryptedWalletStore(state, wrappingSecret);
    this.#permit2 = Object.freeze({ root: state.root, wallets: this.wallets });
  }

  /** The exact local wallet native of `root` may sign Permit2 production bundles; a subclass or another native may not. */
  static permit2Signer(native: NativePort, root: string): LocalWalletNative {
    if (typeof native !== "object" || native === null || !(#permit2 in native) || Object.getPrototypeOf(native) !== LocalWalletNative.prototype ||
      native.#permit2.root !== root) throw protocol("Selected native is not the exact local Permit2 signer for this state.");
    return native;
  }

  /**
   * The one Permit2 production signer. Under the operation's metadata locks it re-reads the saved record and lease and
   * signs only while they equal the continuation's (integrity hash, lease digest, wallet binding), the owner's approval
   * names that record and is at most 60 s old, and a chain observation of at most 5 s, taken before and again after the
   * key load, still holds. The saved signed record, not an object identity, is then what one request may send.
   */
  static async signPermit2Production(native: NativePort, fence: Permit2ProductionSigningFence, journal: Permit2ProductionJournal,
    continuation: Permit2SigningContinuation, clock: () => Date): Promise<{ readonly status: ReturnType<typeof publicPermit2Production>; readonly origin: Permit2SignedOrigin }> {
    const { wallets, root } = LocalWalletNative.permit2Signer(native, journal.root).#permit2;
    const { approval, saved: expected } = continuation, id = approval.operationId;
    if (fence.root !== root) throw protocol("Permit2 signing fence belongs to another state.");
    const bundle = await fence.withScope(id, "exposed", async scope => {
      let capturedAt = NaN, latest: Permit2ProductionRecord | undefined, loaded: Awaited<ReturnType<EncryptedWalletStore["describe"]>> = null;
      const approved = () => {
        const at = permit2Now(clock); if (latest === undefined) assertPermit2ApprovalWindow(approval, at);
        else assertPermit2ApprovalCurrent(approval, latest, at);
        return at.getTime();
      };
      const current = async () => { approved(); latest = (await fence.scopeOwner(scope, id, "exposed", expected)).record; approved(); return latest; };
      // The signing second: the approval is current and the last chain observation is under 5 s old.
      const second = () => {
        const at = approved(); if (!Number.isSafeInteger(capturedAt) || at < capturedAt || at - capturedAt > 5_000) throw protocol("Permit2 signing observation expired.");
        return Math.floor(at / 1000);
      };
      const observe = async () => {
        await current(); const checked = await fence.checkScoped(scope, id, "exposed"); await current();
        if (checked.fact === null) throw protocol("Permit2 fresh signing observation refused.");
        capturedAt = Date.parse((await fence.consumeScoped(scope, checked.fact, id, "exposed")).capturedAt); return current();
      };
      const local = async () => { const saved = await current(); second(); return saved; };
      try {
        const saved = await observe(); second();
        loaded = await wallets.describe(saved.material.wallet.profile, second);
        await current(); if (loaded === null) throw protocol("Permit2 local wallet is missing.");
        const account = privateKeyToAccount(loaded.secret.privateKey), plan = reconstructPermit2ProductionMaterial(saved.material);
        if (loaded.identity.profile !== saved.material.wallet.profile || loaded.identity.address.toLowerCase() !== plan.payer.toLowerCase() ||
          account.address.toLowerCase() !== plan.payer.toLowerCase()) throw protocol("Permit2 actual payer differs from the saved local wallet.");
        // Chain observed before and right after key load; around the signatures only local state (record, lease, window).
        await observe();
        let tokenSignature: Hex | null = null;
        if (plan.plan.eip2612 !== null) {
          await local(); tokenSignature = await account.signTypedData(plan.plan.eip2612.typedData as Parameters<typeof account.signTypedData>[0]); await local();
        }
        await local();
        const permit2Signature = await account.signTypedData(plan.plan.permit2 as Parameters<typeof account.signTypedData>[0]);
        const signed = await createPermit2ProductionSigned(await local(), permit2Signature, tokenSignature, second());
        await local(); return signed;
      } finally { if (loaded !== null) wallets.clear(loaded.secret); }
    });
    const saved = await journal.storeSigned(id, bundle);
    assertPermit2ApprovalCurrent(approval, saved, permit2Now(clock));
    if (saved.exposureJournal?.signed?.signedHash !== bundle.signedHash) throw protocol("Permit2 signing origin is no longer current.");
    return Object.freeze({ status: publicPermit2Production(saved), origin: Object.freeze({ approval, signedHash: bundle.signedHash,
      leaseDigest: expected.leaseDigest, walletHash: expected.walletHash }) });
  }

  async request(request: NativeRequest): Promise<unknown> {
    if (request.version !== "apn.native.v1") throw protocol("Unsupported custody request version.");
    const operation = request.operation;
    const payload = operation === "directTransfer.approveAndSign"
      ? snapshotEvmNativePayload(request.payload) : request.payload;
    await this.state.initialize();
    const profile = requestProfile(payload);
    return await this.state.withLocks([walletCustodyLock(this.state, profile)], async () => {
      switch (operation) {
        case "wallet.ensure": return await this.ensureWallet(profile);
        case "wallet.import": return await this.importWallet(profile, payload);
        case "wallet.describe": return await this.describeWallet(profile);
        case "directTransfer.approveAndSign": return await this.approveAndSign(payload);
        case "effectMaterial.get": return await this.getEffect(payload);
        case "directTransfer.signedMaterial.get": return await signedDirectTransaction(this.state, payload, this.withWallet.bind(this));
        case "x402Exact.approveAndAuthorize": return await this.approveX402(payload);
        case "x402Exact.authorizationMaterial.get": return await this.getX402(payload);
        case "x402Permit2.approveAndAuthorize": return await this.approveX402(payload, "permit2");
        case "x402Permit2.authorizationMaterial.get": return await this.getX402(payload, "permit2");
      }
    });
  }
  private async ensureWallet(profile: string): Promise<unknown> {
    const loaded = await this.wallets.ensure(profile);
    try {
      return publicIdentity(loaded.identity);
    } finally {
      this.wallets.clear(loaded.secret);
    }
  }
  private async importWallet(profile: string, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    const keyFile = payload.keyFile; const keyName = payload.keyName; const expectedAddress = payload.expectedAddress;
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
    let bytes: Buffer = Buffer.alloc(0);
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
        if (result.bytesRead === 0) break;
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
      if (matches.length !== 1) throw new ApnError("APN_INVALID_INPUT", "Wallet key name must occur exactly once in the key file.");
      const match = matches[0]!;
      const privateKey = match[2] ?? match[3] ?? match[4] ?? "";
      const identity = await this.wallets.importNew(profile, privateKey, expectedAddress);
      return publicIdentity(identity);
    } finally {
      bytes.fill(0);
      await handle.close();
    }
  }

  private async describeWallet(profile: string): Promise<unknown> {
    const wallet = await this.state.loadWallet(this.state.profileHash(profile));
    if (wallet === null) return { found: false };
    const envelope = await this.state.loadEncryptedWalletEnvelope(profile);
    if (envelope === null) throw protocol("Public wallet has no custody envelope.");
    await assertEvmNativeCustody(this.state, profile, await evmNativeCustody(this.state, profile), walletEnvelopeIdentity(envelope, profile));
    return { found: true, profile: wallet.profile, address: wallet.address, createdAt: wallet.createdAt, bindingHash: wallet.bindingHash };
  }
  private async approveAndSign(payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    const intent = payload.evm === undefined ? Object.freeze(parseDirectIntent(payload)) : parseEvmNativeIntent(payload);
    // Read-only historical shapes: the cleanup85 cancellation and the 0.5.41 Circle native rider never sign again.
    if (intent.evm?.cleanup85Cancellation !== undefined || intent.evm?.circleNativeAdmission !== undefined) throw protocol("A retired historical direct transfer cannot be signed.");
    const frozen = await this.state.findOperation(intent.operationId), journal = new DirectPublicEffectJournal(this.state);
    if (frozen === null || frozen.profile !== intent.profile || frozen.state !== "started" ||
        hashObject(directCustodyPayload(frozen)) !== hashObject(payload)) throw protocol("Native request differs from its saved fresh operation.");
    // beginSigning proves the prepared binding and custody itself; nothing else needs them first.
    if (await journal.hasSigned(frozen)) throw protocol("A signed direct effect cannot be approved or recovered through signing.");
    const attempt = await journal.beginSigning(frozen);
    // Human approval must complete before the Keychain-backed wallet envelope
    // is loaded. This keeps the raw signing key out of memory while approval is
    // pending, refused, interrupted, or expired.
    try { await this.approval.approve(intent); }
    catch (error) {
      // This catch encloses only foreground approval, before any private wallet entry.
      // Its proof describes Native control flow, never the meaning or authenticity of callback consent.
      try { await journal.recordNoPrivateEntry(frozen, attempt); } catch { /* Unprovable attempts stay held. */ }
      throw error;
    }
    return await this.withWallet(intent.profile, async (identity, secret) => {
      assertWallet(identity, intent.walletAddress);
      const slot = effectSlot("apn-effect-v1", intent.profile, intent.operationId, intent.fingerprint);
      const payloadHash = hashObject(payload);
      const existing = secret.directEffects[slot];
      if (existing !== undefined) throw protocol("Existing encrypted direct effect requires public observation; signing cannot recover it.");
      if ((intent.evm?.asset.chainId ?? CHAIN_ID) === 1 && await uniswapTokenNonceOwned(this.state.root, identity.address, intent.nonceAtomic)) {
        throw new ApnError("APN_REPREPARE_REQUIRED", "A guarded token effect already owns the approved Ethereum nonce; prepare a fresh transfer.");
      }
      const latest = await this.state.findOperation(intent.operationId);
      if (latest === null || latest.state !== "started" || hashObject(directCustodyPayload(latest)) !== hashObject(payload)) throw protocol("Fresh direct operation changed before signing.");
      const binding = await journal.prepared(latest);
      await assertEvmNativeCustody(this.state, intent.profile, binding.custody, identity);
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
      if (intent.evm !== undefined && (rawTransaction.length - 2) / 2 > MAX_DIRECT_TRANSACTION_BYTES) throw protocol("Signed transaction exceeds its data-fee quote size bound.");
      const transactionHash = keccak256(rawTransaction);
      const effect: DirectEffectMaterial = {
        payloadHash, operationId: intent.operationId,
        transactionHash,
        rawTransaction,
        rawTransactionHash: transactionHash,
      };
      await assertFreshDirectEffect(this.state, frozen, effect);
      secret.directEffects[slot] = effect;
      await this.wallets.save(identity, secret);
      await publishDirectPublicEffect(this.state, frozen, effect, account);
      return publicDirectEffect(effect);
    }, async identity => {
      const binding = await journal.prepared(frozen);
      await assertEvmNativeCustody(this.state, intent.profile, binding.custody, identity);
    });
  }

  private async getEffect(payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    const recovery = parseDirectRecovery(payload), operation = await this.state.findOperation(recovery.operationId);
    if (operation === null || operation.profile !== recovery.profile || operation.fingerprint !== recovery.fingerprint) throw protocol("Public recovery operation does not match.");
    if ("expectedPayloadHash" in recovery ? recovery.expectedPayloadHash !== hashObject(directCustodyPayload(operation)) :
      recovery.expectedTransactionHash !== operation.transactionHash || recovery.expectedRawTransactionHash !== operation.rawTransactionHash) throw protocol("Public recovery binding does not match.");
    return await new DirectPublicEffectJournal(this.state).effect(operation);
  }

  private async approveX402(payload: Readonly<Record<string, unknown>>, method: X402CustodyMethod = "eip3009"): Promise<unknown> {
    const intent = parseX402Create(payload, method);
    return await this.withWallet(intent.profile, async (identity, secret) => {
      assertWallet(identity, intent.wallet);
      const slot = effectSlot(x402EffectDomain(method), intent.profile, intent.operationId, intent.fingerprint);
      const createPayloadHash = hashObject(payload);
      const recoveryBindingHash = hashObject(x402RecoveryBinding(intent));
      const existing = secret.x402Effects[slot];
      if (existing !== undefined && (existing.createPayloadHash !== createPayloadHash || existing.recoveryBindingHash !== recoveryBindingHash)) {
        throw rejected("APN_X402_AUTHORIZATION_MISMATCH", "Stored x402 authorization differs from the frozen request.");
      }
      ensureX402Live(intent.authorization.validBefore); // never sign, or return, an authorization no chain can settle
      if (existing !== undefined) return publicX402Effect(existing);
      const account = privateKeyToAccount(secret.privateKey);
      let eip2612Signature: Hex | undefined;
      let signature: Hex;
      if (intent.permit2 !== undefined) {
        // Permit2 witness transfer: the typed data is rebuilt here from the frozen terms, never taken from the caller.
        const terms = { chainId: Number(intent.chainId), token: intent.token, from: intent.authorization.from, to: intent.authorization.to,
          value: intent.authorization.value, nonce: intent.authorization.nonce, deadline: intent.authorization.validBefore };
        signature = await account.signTypedData(x402Permit2TypedData(terms) as Parameters<typeof account.signTypedData>[0]);
        if (intent.permit2.eip2612 !== null) {
          eip2612Signature = await account.signTypedData(x402Eip2612TypedData(terms, intent.permit2.eip2612) as Parameters<typeof account.signTypedData>[0]);
        }
      } else {
        signature = await account.signTypedData({
          domain: {
            name: intent.tokenDomain!.name,
            version: intent.tokenDomain!.version,
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
      }
      const authorization = publicAuthorization(intent.authorization);
      const effect: X402EffectMaterial = {
        createPayloadHash,
        recoveryBindingHash,
        authorization,
        signature,
        signatureHash: domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")),
        ...(eip2612Signature === undefined ? {} : { eip2612Signature }),
      };
      secret.x402Effects[slot] = effect;
      await this.wallets.save(identity, secret);
      return publicX402Effect(effect);
    });
  }

  private async getX402(payload: Readonly<Record<string, unknown>>, method: X402CustodyMethod = "eip3009"): Promise<unknown> {
    const recovery = parseX402Recovery(payload, method);
    return await this.withWallet(recovery.profile, async (identity, secret) => {
      assertWallet(identity, recovery.wallet);
      const slot = effectSlot(x402EffectDomain(method), recovery.profile, recovery.operationId, recovery.fingerprint);
      const effect = secret.x402Effects[slot];
      if (effect === undefined) throw rejected("APN_X402_AUTHORIZATION_NOT_FOUND", "x402 authorization material was not found.");
      const expectedHash = hashObject(x402RecoveryBinding(recovery));
      if (effect.recoveryBindingHash !== expectedHash || (recovery.expectedSignatureHash !== undefined && effect.signatureHash !== recovery.expectedSignatureHash)) {
        throw rejected("APN_X402_AUTHORIZATION_MISMATCH", "x402 recovery binding does not match.");
      }
      ensureX402Live(recovery.authorization.validBefore);
      return publicX402Effect(effect);
    });
  }

  private async withWallet<T>(
    profile: string,
    action: (identity: WalletIdentity, secret: WalletSecretState) => Promise<T>,
    beforeKeyLoad?: (identity: WalletIdentity) => Promise<void>,
  ): Promise<T> {
    const loaded = await this.wallets.describe(profile, undefined, beforeKeyLoad);
    if (loaded === null) throw rejected("APN_WALLET_NOT_FOUND", "Wallet is not initialized.");
    try {
      return await action(loaded.identity, loaded.secret);
    } finally {
      this.wallets.clear(loaded.secret);
    }
  }
}

/** Separate custody slots: an EIP-3009 authorization and a Permit2 witness transfer of one operation never share one. */
function x402EffectDomain(method: X402CustodyMethod): string { return method === "eip3009" ? "apn-x402-effect-v1" : "apn-x402-permit2-effect-v1"; }
