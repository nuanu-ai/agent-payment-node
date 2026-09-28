import { performance } from "node:perf_hooks";
import { getAddress } from "viem";
import { isPlainRecord } from "../canonical.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { HttpsBaseRpc } from "../rpc.js";
import { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { walletEnvelopeIdentity } from "../encrypted-wallet-store.js";
import { decodeCanonicalBase64Json, decodePaymentRequiredHeader } from "../x402-codec.js";
import { createPermit2ProductionReadPort, type Permit2ReadRpcSource, type Permit2UsageReader } from "./read-port.js";
import { preparePermit2WithPort } from "./prepare.js";
import type { Permit2Requirement } from "./offer.js";
import type { GaslessTransport } from "../gasless/https.js";

export interface Permit2PreflightRequest {
  readonly profile: string;
  readonly paymentRequired: string;
  readonly expectedChallengeHash: string;
  readonly expectedIndex: string;
  readonly expectedTerms: string;
}

export interface Permit2PreflightPorts {
  readonly rpc: Permit2ReadRpcSource;
  readonly transport?: GaslessTransport;
  readonly now?: () => Date;
  readonly usage?: Permit2UsageReader;
}

/** An unsigned, nonpersistent CLI read. Prepared typed data never crosses this output boundary. */
export async function permit2CurrentOwnerPreflight(root: string, request: Permit2PreflightRequest,
  ports: Permit2PreflightPorts): Promise<unknown> {
  const profile = canonicalProfile(request.profile);
  if (!/^[a-f0-9]{64}$/u.test(request.expectedChallengeHash) ||
      !/^(0|[1-9][0-9]{0,5})$/u.test(request.expectedIndex)) invalid();
  const expected = decodeCanonicalBase64Json(request.expectedTerms);
  if (!isPlainRecord(expected)) invalid();
  const challenge = decodePaymentRequiredHeader(request.paymentRequired);
  const state = new StateStore(root);
  const profileHash = state.profileHash(profile);
  const localAccount = async (): Promise<Address> => {
    const artifacts = await state.loadWalletArtifacts(profile, profileHash);
    const provider = await state.loadProviderProfile(profileHash);
    if (artifacts.stored === null || artifacts.encrypted === null ||
        provider !== null && provider.provider_id !== "local") {
      throw new ApnError("APN_OPERATION_BLOCKED", "A current local owner wallet is required.",
        { reason: "x402_permit2_local_wallet_required" });
    }
    const envelope = walletEnvelopeIdentity(artifacts.encrypted, profile);
    if (artifacts.stored.profile !== profile || artifacts.stored.profileHash !== profileHash ||
        artifacts.stored.address.toLowerCase() !== envelope.address.toLowerCase() ||
        artifacts.stored.bindingHash !== envelope.bindingHash ||
        provider !== null && (provider.public_address.toLowerCase() !== envelope.address.toLowerCase() ||
          provider.account_binding_hash !== envelope.bindingHash)) {
      throw new ApnError("APN_PROFILE_DRIFT", "Local owner wallet records disagree.");
    }
    return getAddress(envelope.address);
  };
  const payer = await localAccount();
  const now = ports.now ?? (() => new Date());
  const at = now();
  const read = createPermit2ProductionReadPort({ profile, stateRoot: root, localAccount,
    usage: ports.usage ?? { usage: (identity, when) => new AssetUsageLedger(root).usageReadOnly(identity, when) },
    rpc: ports.rpc, ...(ports.transport === undefined ? {} : { transport: ports.transport }), now });
  const prepared = await preparePermit2WithPort(read, { payer, localWallet: true, challenge,
    expected: { challengeHash: request.expectedChallengeHash, index: Number(request.expectedIndex),
      requirement: expected as unknown as Permit2Requirement }, nowSeconds: Math.floor(at.getTime() / 1000) });
  return { profile, state: "admissible_unsigned", capability: "execution_blocked", chain: prepared.chain,
    payer: prepared.payer, recipient: prepared.payTo, token: prepared.token,
    amountAtomic: prepared.amountAtomic, deadline: prepared.expiresAtUnix,
    challengeHash: prepared.challengeHash, offerHash: prepared.offerHash,
    policyDigest: prepared.policyDigest, prepareHash: prepared.prepareHash,
    blockerCodes: ["permit2_execution_not_exposed"] };
}

/** Sequential public HTTPS source, with a per-process gap and no retry or send method. */
export function permit2PublicRpc(url: string): Permit2ReadRpcSource {
  const rpc = new HttpsBaseRpc(url);
  let lastStart = 0;
  return { async call(method, params, signal) {
    const wait = Math.max(0, lastStart + 250 - performance.now());
    if (wait > 0) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new ApnError("APN_RPC_PROTOCOL", "Permit2 RPC read was aborted.")); }, { once: true });
    });
    if (signal.aborted) throw new ApnError("APN_RPC_PROTOCOL", "Permit2 RPC read was aborted.");
    lastStart = performance.now();
    return await rpc.permit2ReadCall(method, params, signal);
  } };
}

function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "Expected Permit2 selection is invalid."); }
