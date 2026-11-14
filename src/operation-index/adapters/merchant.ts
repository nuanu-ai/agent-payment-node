import { evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { MERCHANT_TERMINAL_PHASES, publicMerchant, type MerchantOperation } from "../../x402-merchant/model.js";
import { MerchantRepository } from "../../x402-merchant/repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";

const STORE: OperationStore = { directory: "merchant-x402", perProfile: false };

export function merchantDomains(record: MerchantOperation): readonly MoneyConflictDomain[] {
  return [evmConflictDomain(4326, record.custody.walletAddress)];
}

/**
 * Merchant x402 payments on MegaETH. Only the family's own recorded outcomes end the claim, the phase 4c exits included
 * (never sent, superseded at the finalized nonce, owner abandon, delivery attempts exhausted). The wall clock never
 * does: approve signs a `prepared` payment while the machine's clock reads inside its 300 s deadline, so a clock that
 * once ran past the deadline and then went back would leave a payment approve can still sign without its account
 * guard. A payment past its deadline lets go when `x402 merchant observe` (or `operation abandon`) records it
 * `failed_before_effect`, a durable state approve never leaves, releasing any hold a crashed approval reserved.
 * Through 0.5.106 a `prepared` payment let go by the clock alone, 10 minutes after its deadline.
 */
export const merchantTerminal = (record: Pick<MerchantOperation, "state">): boolean => MERCHANT_TERMINAL_PHASES.includes(record.state);

export const merchantAdapter: OperationFamilyAdapter<MerchantOperation> = {
  family: "merchant_x402",
  stores: [STORE],
  async load(root, recordPath) {
    return await new MerchantRepository(root).findOperation(requiredRecordPath(recordPath, STORE).operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims(merchantDomains(record))),
  terminal: merchantTerminal,
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageEvm(4326, field(value, "custody", "walletAddress"))]),
  view: async record => publicMerchant(record),
  // The owner exit: a proven exit first (no consent), else TTY consent ends an attempt nothing can decide (holds stay charged).
  abandon: async (context, record) => {
    const [{ MerchantExits }, { MerchantRpc }] = await Promise.all([import("../../x402-merchant/exits.js"), import("../../x402-merchant/rpc.js")]);
    return publicMerchant(await new MerchantExits(context.state, new MerchantRpc(context.state), () => context.clock.now())
      .abandon(record.operationId, context.requireOperationAbandonApproval()));
  },
  // Merchant observation and the unsent retirement run on their own bounded CLI path; its status carries the payment and delivery evidence.
  commands: { status: "apn x402 merchant status --operation <operation-id>", resume: "apn x402 merchant observe --operation <operation-id>",
    exit: "apn x402 merchant retire-unsent --operation <operation-id>" },
};
