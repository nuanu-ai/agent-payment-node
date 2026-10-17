/** A real, fully validating Smart Account gasless material record (as in smart-account-gasless-material.test.ts). */
import { hashDelegation } from "@metamask/delegation-core";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import { decodeDelegations, encodeDelegations, toDelegationStruct } from "@metamask/smart-accounts-kit/utils";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import type { UnsealedSmartAccountGaslessMaterial } from "../../src/encrypted-smart-account-gasless-material-store.js";
import type { Address, Hex } from "../../src/model.js";
import { OfficialErc7710Engine } from "../../src/smart-account-erc7710/engine.js";
import { validateErc7710Material } from "../../src/smart-account-erc7710/validation.js";
import { saRootContextHash } from "../../src/smart-account-gasless/integrity.js";
import { SmartAccountGaslessMaterialValidator, directIntent } from "../../src/smart-account-gasless/material.js";
import type { SmartAccountGaslessIntent, SmartAccountGaslessPayload } from "../../src/smart-account-gasless/model.js";
import { saTestIntent } from "./smart-account-gasless-fixtures.js";

const KEY = `0x${"2".repeat(64)}` as Hex;
const SESSION = privateKeyToAccount(KEY).address.toLowerCase() as Address;
const OWNER = privateKeyToAccount(`0x${"1".repeat(64)}` as Hex).address.toLowerCase() as Address;
const FINGERPRINT = "5".repeat(64);

export async function smartAccountGaslessRecord(operationId: string): Promise<UnsealedSmartAccountGaslessMaterial> {
  const root = encodeDelegations([{ delegate: SESSION, delegator: OWNER, authority: ROOT_AUTHORITY,
    caveats: [], salt: "0x01", signature: `0x${"11".repeat(65)}` }]).toLowerCase() as Hex;
  const decodedRoot = decodeDelegations(root)[0]!;
  const intent = structuredClone(saTestIntent()) as SmartAccountGaslessIntent;
  const binding = intent.binding as unknown as Record<string, unknown>, safe = intent.initialSnapshot.safeState as unknown as Record<string, unknown>;
  binding.ownerAddress = OWNER; binding.sessionAddress = SESSION;
  binding.accountBindingHash = sha256(`provider-account-binding\0metamask-smart-account\0${OWNER}`);
  binding.encodedRootHash = saRootContextHash(root);
  binding.rootDelegationHash = hashDelegation(toDelegationStruct(decodedRoot)).toLowerCase();
  safe.ownerAddress = OWNER; safe.sessionAddress = SESSION;
  const neutral = directIntent(operationId, FINGERPRINT, intent, root);
  const payment = await new OfficialErc7710Engine().create(neutral, { sessionPrivateKey: KEY, rootContext: root });
  const validated = await validateErc7710Material(neutral, payment);
  const hashes = await new SmartAccountGaslessMaterialValidator().validate({ operationId, fingerprint: FINGERPRINT,
    intent, paymentPayload: payment as unknown as SmartAccountGaslessPayload, rootContext: root });
  const canonicalPayment: SmartAccountGaslessPayload = { x402Version: 2, accepted: intent.requirements,
    payload: { delegationManager: intent.binding.delegationManager, delegator: intent.binding.ownerAddress,
      permissionContext: validated.permissionContext } };
  return { schema_version: "apn.smart-account-gasless-material.v1", operation_id: operationId,
    profile_hash: intent.binding.profileHash, fingerprint: FINGERPRINT, request_hash: "6".repeat(64),
    root_grant_fingerprint: intent.binding.rootGrantFingerprint, ...hashes,
    delegation_manager: intent.binding.delegationManager, delegator: OWNER, root_context: validated.encodedRoot,
    encoded_child: validated.encodedChild, permission_context: validated.permissionContext,
    payment_payload_canonical_json: canonicalJson(canonicalPayment), phase: "sealed", sealed_at: intent.preparedAt,
    updated_at: intent.preparedAt };
}
