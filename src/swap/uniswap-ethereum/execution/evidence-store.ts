import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../../canonical.js";
import { ApnError } from "../../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../../secure-state-store.js";
import { validateSwapOperation, type SwapOperationRecord } from "../../model.js";

const EVIDENCE_VERSION = "apn.uniswap-balance-evidence.v1";
const HASH = /^[0-9a-f]{64}$/u, HEX32 = /^0x[0-9a-fA-F]{64}$/u, UINT = /^(?:0|[1-9][0-9]{0,77})$/u;

/**
 * Native and output-token balances around the swap block, read on first sight of the receipt while a pruning full
 * node still serves that state (about the last 128 blocks). Finality comes 65–95 blocks later, so a status call made
 * after that window reuses this evidence instead of needing historical state. It is valid only for the exact block
 * hash it names; after a reorg the observer reads it again.
 */
export interface UniswapBalanceEvidence {
  readonly schemaVersion: typeof EVIDENCE_VERSION;
  readonly operationId: string;
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: string;
  readonly blockHash: `0x${string}`;
  readonly beforeNative: string;
  readonly afterNative: string;
  readonly beforeOutput: string;
  readonly afterOutput: string;
  readonly capturedAt: string;
  readonly evidenceHash: string;
}
export type UniswapBalanceEvidenceBody = Omit<UniswapBalanceEvidence, "schemaVersion" | "evidenceHash">;
export interface UniswapBalanceEvidencePort {
  load(operation: SwapOperationRecord): Promise<UniswapBalanceEvidence | null>;
  save(operation: SwapOperationRecord, evidence: UniswapBalanceEvidence): Promise<UniswapBalanceEvidence>;
}

export function sealUniswapBalanceEvidence(body: UniswapBalanceEvidenceBody): UniswapBalanceEvidence {
  const unsealed = { schemaVersion: EVIDENCE_VERSION, ...body } as const;
  return Object.freeze({ ...unsealed, evidenceHash: domainHash(EVIDENCE_VERSION, canonicalJson(unsealed)) });
}

export function validateUniswapBalanceEvidence(value: unknown, operation: SwapOperationRecord): UniswapBalanceEvidence {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "transactionHash", "blockNumber", "blockHash",
    "beforeNative", "afterNative", "beforeOutput", "afterOutput", "capturedAt", "evidenceHash"]) || value.schemaVersion !== EVIDENCE_VERSION ||
      value.operationId !== operation.operationId || typeof value.transactionHash !== "string" || !HEX32.test(value.transactionHash) ||
      typeof value.blockHash !== "string" || !HEX32.test(value.blockHash) || typeof value.evidenceHash !== "string" || !HASH.test(value.evidenceHash) ||
      [value.blockNumber, value.beforeNative, value.afterNative, value.beforeOutput, value.afterOutput].some((item) => typeof item !== "string" || !UINT.test(item)) ||
      typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)) || new Date(value.capturedAt).toISOString() !== value.capturedAt) {
    corrupt();
  }
  const { evidenceHash, ...unsealed } = value;
  if (evidenceHash !== domainHash(EVIDENCE_VERSION, canonicalJson(unsealed))) corrupt();
  return Object.freeze(value as unknown as UniswapBalanceEvidence);
}

export class UniswapBalanceEvidenceStore extends SecureStateStore implements UniswapBalanceEvidencePort {
  private initialized: Promise<void> | undefined;

  async load(operationValue: SwapOperationRecord): Promise<UniswapBalanceEvidence | null> {
    const operation = validateSwapOperation(operationValue); await this.ready();
    const value = await this.readJson(this.path(operation));
    return value === null ? null : validateUniswapBalanceEvidence(value, operation);
  }

  /** Keeps the first evidence for a block; evidence for a different block hash (after a reorg) replaces it. */
  async save(operationValue: SwapOperationRecord, evidenceValue: UniswapBalanceEvidence): Promise<UniswapBalanceEvidence> {
    const operation = validateSwapOperation(operationValue), evidence = validateUniswapBalanceEvidence(evidenceValue, operation);
    await this.ready();
    return await this.withLocks([`uniswap-evidence:${operation.operationId}`], async () => {
      const existing = await this.readJson(this.path(operation));
      if (existing !== null) {
        const prior = validateUniswapBalanceEvidence(existing, operation);
        if (prior.transactionHash === evidence.transactionHash && prior.blockHash === evidence.blockHash) return prior;
      }
      await this.ensureDirectory(`uniswap-balance-evidence/${operation.ownerProfileHash}`);
      await this.writeJson(this.path(operation), evidence);
      return evidence;
    });
  }

  private path(operation: SwapOperationRecord): string {
    stateIdentifier(operation.ownerProfileHash, "Uniswap evidence profile"); stateIdentifier(operation.operationId, "Uniswap evidence operation");
    return `uniswap-balance-evidence/${operation.ownerProfileHash}/${operation.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("uniswap-balance-evidence"); })();
    await this.initialized;
  }
}

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Uniswap balance evidence is invalid."); }
