import { evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { publicMerchant, type MerchantOperation } from "../../x402-merchant/model.js";
import { MerchantRepository } from "../../x402-merchant/repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";

const STORE: OperationStore = { directory: "merchant-x402", perProfile: false };

export function merchantDomains(record: MerchantOperation): readonly MoneyConflictDomain[] {
  return [evmConflictDomain(4326, record.custody.walletAddress)];
}

export const merchantAdapter: OperationFamilyAdapter<MerchantOperation> = {
  family: "merchant_x402",
  stores: [STORE],
  async load(root, recordPath) {
    return await new MerchantRepository(root).findOperation(requiredRecordPath(recordPath, STORE).operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims(merchantDomains(record))),
  terminal: record => record.terminal,
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageEvm(4326, field(value, "custody", "walletAddress"))]),
  view: async record => publicMerchant(record),
};
