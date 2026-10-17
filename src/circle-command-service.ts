import { CircleRepository } from "./circle-v2-evm/repository.js";
import { deriveCircleFundingParameters } from "./circle-v2-evm/funding-binding.js";
import { publicKnownCircle, publicCircleFundingOperation, validateKnownCircle } from "./circle-v2-evm/funding-operation.js";
import { exactKeys, isPlainRecord } from "./canonical.js";
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
      case "circle.evm.adopt-external-mint": {if ((await checkedOperation(context, request.operationId)).schemaVersion === "apn.circle-v2-evm-operation.v2") { const service=context.circleFundingEvm;if(service===undefined)unavailable();const op=await service.adoptExternalMint(request.operationId,request.transactionHash);return {...operationOutcome(publicCircleFundingOperation(op)),proofClass:"circle_funding_external_mint_fulfillment",receipt:op.externalFulfillment??null}; }const service=context.circleEvm;if(service===undefined)throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE","Circle EVM runtime unavailable.");const op=await service.adoptExternalMint(request.operationId,request.transactionHash);return {...operationOutcome(publicCircle(op)),proofClass:"circle_external_mint_fulfillment",receipt:op.externalFulfillment??null};}
      case "circle.evm.prepare": {
        // One route: every new operation is v2 with all four economic inputs; the fixed v1 shape is read-only.
        if (!isPlainRecord(request) || !exactKeys(request, ["command", "profile", "destinationProfile", "destinationChain", "idempotencyKey", "funding"])) throw new ApnError("APN_INVALID_INPUT", "Circle prepare requires --profile, --destination-profile, --destination-chain, --idempotency-key, --beneficiary, --gross-atomic, --max-issuer-fee-atomic and --min-mint-atomic.");
        const funding = deriveCircleFundingParameters(request.funding);
        if (funding === null) throw new ApnError("APN_INVALID_INPUT", "Circle funding requires all four inputs.");
        const service = context.circleFundingEvm; if (service === undefined) unavailable();
        return operationOutcome(publicKnownCircle(validateKnownCircle(await service.prepare({ profile: request.profile, destinationProfile: request.destinationProfile, destinationChain: request.destinationChain, idempotencyKey: request.idempotencyKey, funding }))));
      }
      case "circle.evm.approve-source": case "circle.evm.approve-mint": case "circle.evm.observe": case "circle.evm.refresh-attestation": case "circle.evm.cleanup": case "circle.evm.cleanup-nonce": case "circle.evm.status": {
        const op = await checkedOperation(context, request.operationId);
        if (op.schemaVersion === "apn.circle-v2-evm-operation.v2" && request.command === "circle.evm.cleanup-nonce") legacyOnly();
        const service = op.schemaVersion === "apn.circle-v2-evm-operation.v1" ? context.circleEvm : context.circleFundingEvm;
        if (service === undefined) unavailable();
        if (request.command === "circle.evm.status") return operationOutcome(await service.status(request.operationId));
        const result = request.command === "circle.evm.approve-source" ? await service.approveSource(request.operationId) : request.command === "circle.evm.approve-mint" ? await service.approveMint(request.operationId) : request.command === "circle.evm.refresh-attestation" ? await service.refreshAttestation(request.operationId) : request.command === "circle.evm.cleanup-nonce" ? await context.circleEvm!.cleanupNonce(request.operationId) : request.command === "circle.evm.cleanup" ? await service.cleanup(request.operationId) : await service.observe(request.operationId);
        return operationOutcome(publicKnownCircle(validateKnownCircle(result)));
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

async function checkedOperation(context: RuntimeContext, id: string) {
  const op = await new CircleRepository(context.state.root).loadAny(id);
  if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Circle EVM operation was not found.");
  return op;
}
function unavailable(): never { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Selected Circle EVM runtime unavailable."); }
function legacyOnly(): never { throw new ApnError("APN_OPERATION_BLOCKED", "This Circle command requires a legacy V1 operation."); }
