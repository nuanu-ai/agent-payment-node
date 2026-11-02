import { evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { PERMIT2_PRODUCTION_TERMINAL_STATES, Permit2ProductionRepository, publicPermit2Production,
  type Permit2ProductionRecord } from "../../x402-permit2/production-repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";

const STORE: OperationStore = { directory: "permit2-production", perProfile: false };

/** The account on the owner admission's own chain (immutable in the record); released records name eip155:43114. */
export function permit2Domains(record: Permit2ProductionRecord): readonly MoneyConflictDomain[] {
  return [evmConflictDomain(permit2ChainId(record.material.owner.chain), record.material.wallet.account)];
}

function permit2ChainId(chain: unknown): number {
  const match = typeof chain === "string" ? /^eip155:([1-9][0-9]{0,15})$/u.exec(chain) : null;
  if (match === null) throw new Error("Invalid Permit2 chain.");
  return Number(match[1]);
}

/**
 * The family's own outcomes end the claim. An authorization never exposed is ended by the family itself past its
 * deadline: `x402 permit2 observe` runs the expiry release (released_unsubmitted, its usage hold freed).
 */
export const permit2Adapter: OperationFamilyAdapter<Permit2ProductionRecord> = {
  family: "permit2_production",
  stores: [STORE],
  async load(root, recordPath) {
    return await new Permit2ProductionRepository(root).findOperation(requiredRecordPath(recordPath, STORE).operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims(permit2Domains(record))),
  terminal: record => PERMIT2_PRODUCTION_TERMINAL_STATES.includes(record.state),
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageEvm(permit2ChainId(field(value, "material", "owner", "chain")), field(value, "material", "wallet", "account"))]),
  view: async record => publicPermit2Production(record),
  // Observation, including the proof that an expired authorization was never used, runs on Permit2's own CLI path.
  commands: { status: "apn x402 permit2 status --profile <profile> --operation <operation-id>",
    resume: "apn x402 permit2 observe --operation <operation-id> --rpc-url <https-rpc>",
    exit: "apn x402 permit2 observe --operation <operation-id> --rpc-url <https-rpc> --expired-unused" },
};
