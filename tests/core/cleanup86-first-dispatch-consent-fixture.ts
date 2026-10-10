import { firstDispatchFixture } from "./cleanup86-first-dispatch-fixture.js";
import { withCleanup85FinancialScope } from "../../src/circle-cleanup85-financial-scope.js";
import { Cleanup86FirstDispatchJournal } from "../../src/circle-v2-evm/cleanup86-first-dispatch-journal.js";
import { verifyCleanup86FirstDispatchPurpose } from "../../src/circle-v2-evm/cleanup86-first-dispatch-purpose.js";
import { executeCleanup86FirstDispatch } from "../../src/circle-v2-evm/cleanup86-first-dispatch-controller.js";
import type { Cleanup86FirstDispatchGrant, Cleanup86FirstDispatchBinding } from "../../src/circle-v2-evm/cleanup86-first-dispatch-authority.js";
import type { Cleanup86Material } from "../../src/circle-v2-evm/cleanup86-custody.js";
import { exactChainConsent } from "../../src/tty-approval.js";
import { approvalCode } from "../../src/approval-code.js";
/** Genuine /dev/tty fixture. Call only in a real PTY child. No synthetic authority or terminal. */
export async function firstDispatchConsentedFixture(root:string,restore:(f:Awaited<ReturnType<typeof firstDispatchFixture>>,journal:Cleanup86FirstDispatchJournal,grant:Cleanup86FirstDispatchGrant,binding:Cleanup86FirstDispatchBinding)=>Promise<Cleanup86Material>):Promise<void> {
  const f=await firstDispatchFixture(root); f.setClock(Date.now()); await f.renew();
  await withCleanup85FinancialScope(f.state,f.request,f.lineage.operationId,async scope=> {
    const journal=await Cleanup86FirstDispatchJournal.admit(root,f.parent,f.intent),binding={root,operationId:f.parent.operationId,intentHash:f.intent.intentHash,recoveryId:f.recovery.recoveryBinding,envelopeHash:f.intent.envelope.envelopeHash,...f.metadata};
    const certificate=await verifyCleanup86FirstDispatchPurpose(f.state,f.parent,f.recovery,f.intent,binding,f.proof,scope,()=>Date.now());
    await executeCleanup86FirstDispatch(journal,certificate,binding,{
      confirm:(purpose,deadline)=>exactChainConsent(["TEST FIRST DISPATCH exact sealed zero approval",`Operation ${f.parent.operationId}`,`Transaction ${binding.transactionHash}`,`Current purpose ${purpose.purposeHash}`],approvalCode("bridge",f.parent.operationId,purpose.purposeHash),deadline,{}),
      restore:grant=>restore(f,journal,grant,binding),preflight:async()=>{},send:async()=>{throw Error("TEST no network dispatch");}
    });
  });
}
