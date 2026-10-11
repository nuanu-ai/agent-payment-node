import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked } from "./operation-model.js";
import type { CircleFundingOperationV2 } from "./funding-operation.js";
import { fundingExternalClaimKey, validateFundingExternalFulfillment, type CircleFundingExternalFulfillment } from "./funding-external-proof.js";
export class CircleFundingExternalStore extends SecureStateStore {
  private paths(op:CircleFundingOperationV2):string[]{const result=[`circle-external-claims/operation-${op.operationId}.json`];
    if(op.source!==null&&op.attestation!==null)result.push(`circle-external-claims/message-${hashObject({sourceTransactionHash:op.source.transactionHash,sourceMessageHash:op.source.sourceMessageHash})}.json`,`circle-external-claims/${fundingExternalClaimKey(op)}.json`);return result;}
  async evidence(proof:CircleFundingExternalFulfillment):Promise<unknown>{const x=await this.readJson(`circle-external-evidence/${proof.evidenceHash}.json`);if(x===null||hashObject(x)!==proof.evidenceHash)circleBlocked("external_evidence_missing");return x;}
  async readClaim(op:CircleFundingOperationV2):Promise<CircleFundingExternalFulfillment|null>{let prior:CircleFundingExternalFulfillment|null=null;
    for(const path of this.paths(op)){const x=await this.readJson(path);if(x===null)continue;
      if(!isPlainRecord(x)||!exactKeys(x,["schemaVersion","claimKey","operationId","fingerprint","proof","claimHash"])||x.schemaVersion!=="apn.circle-funding-external-claim.v2")circleBlocked("external_claim_shape");
      const {claimHash,...body}=x;if(claimHash!==hashObject(body)||x.claimKey!==fundingExternalClaimKey(op)||x.operationId!==op.operationId||x.fingerprint!==op.fingerprint)circleBlocked("external_claim_conflict");
      const proof=x.proof as CircleFundingExternalFulfillment;validateFundingExternalFulfillment(proof,op);if(prior!==null&&canonicalJson(prior)!==canonicalJson(proof))circleBlocked("external_claim_replacement");prior=proof;
    }return prior;}
  /** Public permanent tombstone: a restored owned mint cannot enter consent, estimation or custody. */
  async assertOwnedMintAvailable(op:CircleFundingOperationV2):Promise<void>{if(await this.readClaim(op)!==null)circleBlocked("external_mint_claimed_owned_entry_forbidden");}
  async claim(op:CircleFundingOperationV2,proof:CircleFundingExternalFulfillment,evidence:unknown):Promise<void>{validateFundingExternalFulfillment(proof,op);const prior=await this.readClaim(op);
    if(prior!==null&&canonicalJson(prior)!==canonicalJson(proof))circleBlocked("external_claim_replacement");
    if(prior===null){if(hashObject(evidence)!==proof.evidenceHash)circleBlocked("external_evidence_digest");await this.initialize();await this.ensureDirectory("circle-external-evidence");await this.ensureDirectory("circle-external-claims");await this.writeJson(`circle-external-evidence/${proof.evidenceHash}.json`,evidence,true);}
    const body={schemaVersion:"apn.circle-funding-external-claim.v2",claimKey:fundingExternalClaimKey(op),operationId:op.operationId,fingerprint:op.fingerprint,proof},claim={...body,claimHash:hashObject(body)};
    for(const path of this.paths(op))if(await this.readJson(path)===null)await this.writeJson(path,claim,true);
  }
}
