import {
  ANY_BENEFICIARY,
  decodeAllowedCalldataTerms,
  decodeERC20TransferAmountTerms,
  decodeRedeemerTerms,
  decodeTimestampTerms,
  decodeValueLteTerms,
  hashDelegation,
} from "@metamask/delegation-core";
import {
  SIGNABLE_DELEGATION_TYPED_DATA,
  decodeDelegations,
  encodeDelegations,
  toDelegationStruct,
} from "@metamask/smart-accounts-kit/utils";
import { getAddress, isAddress, isHex, pad, recoverTypedDataAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { smartAccountEnvironment } from "../metamask-smart-account-grant.js";
import type { Address, Hex } from "../model.js";
import type {
  Erc7710MaterialIntent,
  Erc7710PaymentPayload,
  Erc7710ValidatedMaterial,
  Erc7710WirePayload,
} from "./intent.js";

export async function validateErc7710Material(
  intent: Erc7710MaterialIntent,
  payment: Erc7710PaymentPayload,
): Promise<Erc7710ValidatedMaterial> {
  if (!isPlainRecord(payment) || !exactKeys(payment, ["x402Version", "accepted", "payload"]) ||
    payment.x402Version !== 2 || canonicalJson(payment.accepted) !== canonicalJson(intent.requirements)) {
    protocol();
  }
  const wire = strictWire(payment.payload);
  if (wire.delegationManager.toLowerCase() !== intent.delegationManager ||
    wire.delegator.toLowerCase() !== intent.ownerAddress) protocol();
  let chain;
  try { chain = decodeDelegations(wire.permissionContext); }
  catch { return protocol(); }
  if (chain.length !== 2 || chain[0] === undefined || chain[1] === undefined) protocol();
  const [child, root] = chain;
  const encodedRoot = encodeDelegations([root]).toLowerCase() as Hex;
  const expectedRoot = intent.rootContext.toLowerCase() as Hex;
  let actualSalt: bigint;
  try { actualSalt = BigInt(child.salt); } catch { return protocol(); }
  if (encodedRoot !== expectedRoot || child.delegate.toLowerCase() !== ANY_BENEFICIARY.toLowerCase() ||
    child.delegator.toLowerCase() !== intent.sessionAddress ||
    child.authority.toLowerCase() !== hashDelegation(toDelegationStruct(root)).toLowerCase() ||
    actualSalt !== BigInt(intent.salt) ||
    encodeDelegations([child, root]).toLowerCase() !== wire.permissionContext.toLowerCase()) protocol();
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: { chainId: intent.chainId, name: "DelegationManager", version: "1",
        verifyingContract: intent.delegationManager },
      types: SIGNABLE_DELEGATION_TYPED_DATA,
      primaryType: "Delegation",
      message: toDelegationStruct({ ...child, signature: "0x" }),
      signature: child.signature,
    });
  } catch { return protocol(); }
  if (recovered.toLowerCase() !== intent.sessionAddress) protocol();
  validateCaveats(child.caveats, intent);
  const encodedChild = encodeDelegations([child]).toLowerCase() as Hex;
  return {
    encodedRoot,
    encodedChild,
    permissionContext: wire.permissionContext.toLowerCase() as Hex,
    rootDelegationHash: hashDelegation(toDelegationStruct(root)).toLowerCase() as Hex,
    childDelegationHash: hashDelegation(toDelegationStruct(child)).toLowerCase() as Hex,
  };
}

function strictWire(value: unknown): Erc7710WirePayload {
  if (!isPlainRecord(value) || !exactKeys(value, ["delegationManager", "delegator", "permissionContext"]) ||
    typeof value.delegationManager !== "string" || !isAddress(value.delegationManager, { strict: false }) ||
    typeof value.delegator !== "string" || !isAddress(value.delegator, { strict: false }) ||
    typeof value.permissionContext !== "string" ||
    !isHex(value.permissionContext) || value.permissionContext === "0x") protocol();
  return value as unknown as Erc7710WirePayload;
}

function validateCaveats(caveats: readonly { readonly enforcer: Hex; readonly terms: Hex; readonly args: Hex }[],
  intent: Erc7710MaterialIntent): void {
  const e = smartAccountEnvironment().caveatEnforcers;
  const expected = [e.ValueLteEnforcer, e.ERC20TransferAmountEnforcer, e.AllowedCalldataEnforcer,
    e.TimestampEnforcer, e.RedeemerEnforcer];
  const args = ["0x00", "0x00", "0x", "0x00", "0x"];
  if (expected.some(value => value === undefined) || caveats.length !== 5 ||
    new Set(caveats.map(value => value.enforcer.toLowerCase())).size !== 5 || expected.some((address, index) =>
      caveats.filter(value => value.enforcer.toLowerCase() === address?.toLowerCase() &&
        value.args.toLowerCase() === args[index]).length !== 1)) protocol();
  const get = (address: Hex | undefined) => caveats.find(value => value.enforcer.toLowerCase() === address?.toLowerCase())!;
  try {
    const value = decodeValueLteTerms(get(expected[0]).terms);
    const amount = decodeERC20TransferAmountTerms(get(expected[1]).terms);
    const calldata = decodeAllowedCalldataTerms(get(expected[2]).terms);
    const timestamp = decodeTimestampTerms(get(expected[3]).terms);
    const redeemer = decodeRedeemerTerms(get(expected[4]).terms);
    const actualRedeemers = redeemer.redeemers.map(address => getAddress(address).toLowerCase()).sort();
    const expectedRedeemers = [...intent.facilitatorAddresses].map(address => address.toLowerCase()).sort();
    if (value.maxValue !== 0n || getAddress(amount.tokenAddress).toLowerCase() !== intent.token ||
      amount.maxAmount !== BigInt(intent.amountAtomic) || calldata.startIndex !== 4 ||
      calldata.value.toLowerCase() !== pad(intent.payee, { size: 32 }).toLowerCase() ||
      timestamp.afterThreshold !== intent.afterUnix || timestamp.beforeThreshold !== intent.beforeUnix ||
      canonicalJson(actualRedeemers) !== canonicalJson(expectedRedeemers)) protocol();
  } catch (error) {
    if (error instanceof ApnError) throw error;
    protocol();
  }
}

function protocol(): never {
  throw new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask ERC-7710 material failed independent validation.", {
    reason: "sa_gasless_provider_protocol",
  });
}
