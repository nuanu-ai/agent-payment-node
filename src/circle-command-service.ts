import type { CommandRequest, CommandOutcome } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
import { ApnError } from "./errors.js";
import { dataOutcome, operationOutcome } from "./core-outcome.js";
import { publicCircle } from "./circle-v2-evm/operation-model.js";
import { bridgeOwner } from "./lifi/owner.js";
import { publicCircleApproval } from "./lifi/circle-v2-approval-executor.js";
import { confirmCircleApproval } from "./lifi/circle-v2-approval-tty.js";

/** Dispatch preserves the distinct legacy approval and finite EVM operation boundaries. */
export async function executeCircleCommand(request: Extract<CommandRequest, { command: `circle.${string}` }>,
  context: RuntimeContext): Promise<CommandOutcome> {
  switch (request.command) {
      case "circle.evm.adopt-external-mint": {const service=context.circleEvm;if(service===undefined)throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE","Circle EVM runtime unavailable.");const op=await service.adoptExternalMint(request.operationId,request.transactionHash);return {...operationOutcome(publicCircle(op)),proofClass:"circle_external_mint_fulfillment",receipt:op.externalFulfillment??null};}

      case "circle.evm.cleanup85-prepare": case "circle.evm.cleanup85-cancel": case "circle.evm.cleanup86-approve": {
        const service = context.circleEvm; if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle EVM runtime unavailable.");
        if (request.command === "circle.evm.cleanup85-prepare") return dataOutcome(await service.prepareCleanup85Recovery(request.operationId), "circle_cleanup85_recovery_prepared_unsigned");
        if (request.command === "circle.evm.cleanup85-cancel") return dataOutcome(await service.cancelCleanup85(request.operationId), "circle_cleanup85_distinct_native_cancellation");
        await service.approveCleanup86(request.operationId); return operationOutcome(await service.status(request.operationId));
      }
      case "circle.evm.prepare": {
        const service = context.circleEvm; if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle EVM runtime unavailable.");
        return operationOutcome(publicCircle(await service.prepare(request)));
      }
      case "circle.evm.approve-source": case "circle.evm.approve-mint": case "circle.evm.observe": case "circle.evm.refresh-attestation": case "circle.evm.cleanup": case "circle.evm.cleanup-nonce": case "circle.evm.status": {
        const service = context.circleEvm; if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle EVM runtime unavailable.");
        if (request.command === "circle.evm.status") return operationOutcome(await service.status(request.operationId));
        const result = request.command === "circle.evm.approve-source" ? await service.approveSource(request.operationId) : request.command === "circle.evm.approve-mint" ? await service.approveMint(request.operationId) : request.command === "circle.evm.refresh-attestation" ? await service.refreshAttestation(request.operationId) : request.command === "circle.evm.cleanup-nonce" ? await service.cleanupNonce(request.operationId) : request.command === "circle.evm.cleanup" ? await service.cleanup(request.operationId) : await service.observe(request.operationId);
        return operationOutcome(publicCircle(result));
      }
      case "circle.approval.prepare": {
        await context.ready();
        const owner = (await bridgeOwner(context.state, request.profile)).owner;
        const executor = context.circleApproval;
        if (executor === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle approval executor is unavailable.");
        return dataOutcome(publicCircleApproval(await executor.prepare({ profile: owner.profile, payer: owner.address,
          walletBindingHash: owner.walletBindingHash, walletCreatedAt: owner.walletCreatedAt,
          approvalCapAtomic: request.approvalCapAtomic })), "circle_approval_prepared_unsigned");
      }
      case "circle.approval.execute":
      case "circle.approval.status": {
        const executor = context.circleApproval;
        if (executor === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle approval executor is unavailable.");
        const record = request.command === "circle.approval.execute"
          ? await executor.execute(request.operationId, confirmCircleApproval)
          : await executor.status(request.operationId);
        return dataOutcome(publicCircleApproval(record), record.phase === "completed" ? "circle_approval_safe_receipt_and_allowance" : "circle_approval_journal_state");
      }
      case "circle.source.submit": {
        const service = context.circleSource;
        if (service === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Circle source runtime is unavailable.");
        return dataOutcome(await service.submit(request), "circle_base_source_submission_only");
      }
  }
}
