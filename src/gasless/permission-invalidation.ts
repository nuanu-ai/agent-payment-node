import { hashObject } from "../canonical.js";
import type { GaslessAccountState, GaslessIntent, GaslessPermissionInvalidation } from "./model.js";
import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import { permissionInvalidationSchema } from "./schema.js";
import { gaslessFailure, gaslessSame } from "./validation.js";

export const GASLESS_PERMISSIONS_INVALIDATED = "gasless_bootstrap_permissions_invalidated";
export const GASLESS_FINAL_PERMISSIONS_INVALIDATED = "gasless_final_permissions_invalidated";

export function validateGaslessPermissionInvalidation(intent: GaslessIntent, bootstrapMaterialHash: string,
  value: unknown): GaslessPermissionInvalidation {
  if (!permissionInvalidationSchema.safeParse(value).success) invalid();
  const p = value as GaslessPermissionInvalidation, initial = intent.initialSnapshot;
  const final = p.userOperationMaterialHash !== undefined;
  if (final !== (p.userOperationHash !== undefined)) invalid();
  if ([p.safeBlock, p.headBlock].some((b) => /^0x0{64}$/u.test(b.hash))) invalid();
  if (p.chainId !== intent.request.chainId || p.intentHash !== hashObject(intent) ||
    p.bootstrapMaterialHash !== bootstrapMaterialHash || p.protocolHash !== initial.protocolHash ||
    BigInt(p.safeBlock.numberAtomic) < BigInt(initial.block.numberAtomic) ||
    BigInt(p.safeBlock.timestampAtomic) < BigInt(initial.block.timestampAtomic) ||
    BigInt(p.headBlock.numberAtomic) < BigInt(p.safeBlock.numberAtomic) ||
    BigInt(p.headBlock.timestampAtomic) < BigInt(p.safeBlock.timestampAtomic) ||
    (p.safeBlock.numberAtomic === initial.block.numberAtomic && !gaslessSame(p.safeBlock, initial.block)) ||
    (p.headBlock.numberAtomic === p.safeBlock.numberAtomic &&
      (!gaslessSame(p.headBlock, p.safeBlock) || !gaslessSame(p.headAccount, p.safeAccount)))) invalid();
  for (const account of [p.safeAccount, p.headAccount]) if (!invalidated(intent, account, final)) invalid();
  if (BigInt(p.safeAccount.permitNonceAtomic) > BigInt(p.headAccount.permitNonceAtomic) ||
    BigInt(p.safeAccount.eoaNonceAtomic) > BigInt(p.headAccount.eoaNonceAtomic) ||
    BigInt(p.safeAccount.entryPointNonceAtomic) > BigInt(p.headAccount.entryPointNonceAtomic) ||
    p.headAccount.pendingEoaNonceAtomic !== p.headAccount.eoaNonceAtomic ||
    p.safeAccount.pendingEoaNonceAtomic !== p.safeAccount.eoaNonceAtomic) invalid();
  return p;
}

export function assertGaslessPermissionClosure(op: Pick<GaslessOperationRecord, "intent">,
  s: GaslessMutable): GaslessPermissionInvalidation {
  const o = s.observation, u = s.userOperation, b = s.bootstrap;
  if (o?.status !== "permissions_invalidated" || o.permissionInvalidation === undefined ||
    o.transactionHash !== null || o.settlement !== null || s.settlement !== null ||
    b.signingAttempts !== 1 || b.materialHash === null || b.sealedAt === null ||
    o.evidenceHash !== hashObject(o.permissionInvalidation)) invalid();
  const p = validateGaslessPermissionInvalidation(op.intent, b.materialHash!, o!.permissionInvalidation);
  if (p.userOperationMaterialHash === undefined) {
    if (u.signingAttempts !== 0 || u.disclosureAttempts !== 0 || u.submissionAttempts !== 0 ||
      u.phase !== "unsealed" || u.materialHash !== null || u.userOperationHash !== null ||
      o!.reason !== GASLESS_PERMISSIONS_INVALIDATED) invalid();
  } else if (u.signingAttempts !== 1 || u.materialHash !== p.userOperationMaterialHash ||
    u.userOperationHash !== p.userOperationHash || u.sealedAt === null ||
    u.disclosureAttempts !== 0 || ["signing_started", "unsealed", "safe_success", "safe_revert"].includes(u.phase) ||
    o!.reason !== GASLESS_FINAL_PERMISSIONS_INVALIDATED ||
    !gaslessSame(o!.cursor.startBlock, op.intent.initialSnapshot.block) ||
    !gaslessSame(o!.cursor.previousEndBlock, p.safeBlock) ||
    BigInt(o!.cursor.nextBlockAtomic) !== BigInt(p.safeBlock.numberAtomic) + 1n) invalid();
  return p;
}

function invalidated(intent: GaslessIntent, account: GaslessAccountState, final: boolean): boolean {
  const initial = intent.initialSnapshot;
  return account.owner === intent.owner.address && account.allowanceAtomic === "0" &&
    BigInt(account.permitNonceAtomic) > BigInt(initial.permitNonceAtomic) &&
    (final ? BigInt(account.entryPointNonceAtomic) > BigInt(initial.entryPointNonceAtomic)
      : account.entryPointNonceAtomic === initial.entryPointNonceAtomic) &&
    BigInt(account.eoaNonceAtomic) >= BigInt(initial.eoaNonceAtomic) + (initial.delegation === "empty" ? 1n : 0n);
}
function invalid(): never { return gaslessFailure("APN_STATE_CORRUPT", "gasless_permission_invalidation_binding"); }
