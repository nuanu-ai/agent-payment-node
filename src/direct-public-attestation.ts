import type { PrivateKeyAccount } from "viem/accounts";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { DirectAllowlistGate } from "./direct-allowlist-gate.js";
import { evmAllowlistSubject } from "./evm-direct-allowlist.js";
import type { DirectEffectMaterial } from "./encrypted-wallet-store.js";
import { ApnError } from "./errors.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import { verifyEffect } from "./transfer-policy.js";

/** Checks one canonical operation and exact signed bytes; it cannot read custody or submit. */
export async function assertFreshDirectEffect(state:StateStore,operation:OperationRecord,effect:DirectEffectMaterial):Promise<void>{
 const journal=new DirectPublicEffectJournal(state);
 await verifyEffect(effect,operation);
 await journal.prepared(operation);
 if(operation.evm!==undefined){
  await new DirectAllowlistGate({state,clock:{now:()=>new Date()}}).confirm(evmAllowlistSubject(operation),operation.allowlist);
 }
 await journal.prepared(operation);
}

/** Called inside Native's already-loaded custody context after its encrypted effect was saved. */
export async function publishDirectPublicEffect(state:StateStore,operation:OperationRecord,effect:DirectEffectMaterial,account:PrivateKeyAccount):Promise<void>{
 if(operation.state!=="started"||operation.terminal||operation.providerDirect!==undefined||
  account.address.toLowerCase()!==operation.walletAddress.toLowerCase())
  throw new ApnError("APN_OPERATION_BLOCKED","Direct public attestation requires the exact freshly signed local operation.");
 const journal=new DirectPublicEffectJournal(state);
 // The journal constructs APN_DIRECT_PUBLIC_EFFECT_PROOF_V1 from the saved operation and public hashes only.
 const attestation=await account.signMessage({message:await journal.attestationMessage(operation,effect)});
 await journal.publish(operation,effect,attestation);
}
