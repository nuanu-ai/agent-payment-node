import type { CommandOutcome, CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import type { RuntimeContext } from "../../runtime.js";
import { SwapOperationRepository } from "../repository.js";
import {
  EMPTY_PROGRAM_SNAPSHOT, JUPITER_SOLANA_SCHEMA, JUPITER_SWAP_API_V2, JUPITER_V2_SOURCE, JUPITER_V6_PROGRAM,
  SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT, WRAPPED_SOL_MINT,
} from "./catalog.js";
import { JUPITER_V1_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_MECHANISM_PIN } from "./v1-pins.js";
import { assertJupiterV1Runtime } from "./v1-runtime-factory.js";
import { swapMechanismDigest } from "../pin.js";
import { JupiterV1DispatchStore } from "./v1-dispatch.js";

export interface JupiterReadOnlyQuoteBuilder {
  quote(input: Extract<CommandRequest, { readonly command: "swap.jupiter.quote" }> & { readonly now: Date }): Promise<unknown>;
}

type Request = Extract<CommandRequest, { readonly command: `swap.jupiter.${string}` }>;
export async function executeJupiterCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome> {
  if (request.command === "swap.jupiter.inventory") return data({ catalog: Object.freeze({ schemaVersion: JUPITER_SOLANA_SCHEMA,
    genesis: SOLANA_MAINNET_GENESIS, api: JUPITER_SWAP_API_V2, program: JUPITER_V6_PROGRAM, nativeInput: WRAPPED_SOL_MINT,
    outputToken: SOLANA_USDC_MINT, source: JUPITER_V2_SOURCE, programSnapshot: EMPTY_PROGRAM_SNAPSHOT }), admitted: false,
    execution: "dormant", v2Quantum: { signable: false, execution: "dormant" }, v1: { mechanismPin: JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(JUPITER_V1_WHIRLPOOL_MECHANISM_PIN), protocolRegistryDigest: JUPITER_V1_PROTOCOL_REGISTRY.registryDigest, installed: context.jupiterV1Runtime !== undefined, provenance: "runtime_bytes_only", admitted: false, additionalFiniteMechanisms:[{mechanismPin:JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN,mechanismDigest:swapMechanismDigest(JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN),protocolRegistryDigest:JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY.registryDigest,admitted:false,genuineSimulation:"pending"}] } }, "official_catalog_not_owner_admission");
  const runtime=context.jupiterV1Runtime;
  if(runtime!==undefined){
    assertJupiterV1Runtime(runtime,context.state.root);
    if(request.command==="swap.jupiter.quote")return data(await runtime.quote(request,context.clock.now()),"unsigned_exact_simulated_swap_quote");
    if(request.command==="swap.jupiter.prepare")return operationOutcome(await runtime.prepare(request,context.clock.now()));
    const op=await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
    if(op===null)throw new ApnError("APN_OPERATION_NOT_FOUND","Swap operation was not found.");
    if(![JUPITER_V1_WHIRLPOOL_MECHANISM_PIN,JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN].some(pin=>op.mechanismDigest===swapMechanismDigest(pin)))throw new ApnError("APN_OPERATION_BLOCKED","This operation belongs to another mechanism.");
    if(request.command==="swap.jupiter.status")return await withDispatch(await runtime.status(request.operationId,context.clock.now()),context);
    if(request.command==="swap.jupiter.approve")return await withDispatch(await runtime.approveAndExecute(request.operationId,context.clock.now()),context);
    if(request.command==="swap.jupiter.execute")return await withDispatch(await runtime.execute(request.operationId,context.clock.now()),context);
  }
  if (request.command === "swap.jupiter.quote") {
    if (context.jupiter === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
      "Jupiter quote requires an explicitly injected read-only builder.", { reason: "jupiter_runtime_unavailable" });
    return data(await context.jupiter.quote({ ...request, now: context.clock.now() }), "unsigned_read_only_swap_quote");
  }
  if (request.command === "swap.jupiter.prepare") throw new ApnError("APN_OPERATION_BLOCKED",
    "No active owner swap admission is installed; catalog presence does not authorize preparation.",
    { reason: "jupiter_owner_admission_required" });
  if (request.command === "swap.jupiter.status") return await status(request.operationId, context);
  throw new ApnError("APN_OPERATION_BLOCKED",
    "Jupiter approval and execution remain blocked because the JUP6 instruction and account ABI is not verified for signing.",
    { reason: "jupiter_v6_instruction_unverified" });
}

async function status(operationId: string, context: RuntimeContext): Promise<CommandOutcome> {
  const operation = await new SwapOperationRepository(context.state.root).loadAny(operationId);
  if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
  return { proofClass: operation.state, data: null, operation, receipt: null, nextActions: [] };
}
function data(value: unknown, proofClass: string): CommandOutcome {
  return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}

function operationOutcome(operation:import("../model.js").SwapOperationRecord):CommandOutcome {
 return {proofClass:operation.state,data:null,operation,receipt:null,nextActions:operation.submissionMarker===null?
  [`apn swap solana jupiter approve --operation ${operation.operationId}`]:[`apn swap solana jupiter status --operation ${operation.operationId}`]};
}
async function withDispatch(operation:import("../model.js").SwapOperationRecord,context:RuntimeContext):Promise<CommandOutcome>{
 const observation=await new JupiterV1DispatchStore(context.state.root).load(operation);
 return {...operationOutcome(operation),data:observation===null?null:{dispatchObservation:observation}};
}
