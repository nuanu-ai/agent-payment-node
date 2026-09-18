import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { x402ExactPermit2ProxyABI } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { getAddress, toFunctionSelector } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ApnError } from "../../src/errors.js";
import type { Address, Hex } from "../../src/model.js";
import { assemblePermit2Payment, planPermit2Authorization, type Permit2TypedData } from "../../src/x402-permit2/authorization.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS } from "../../src/x402-permit2/registry.js";
import { verifyPermit2SettlementReceipt } from "../../src/x402-permit2/settlement.js";

const ACCEPTS = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as { accepts: unknown[] }).accepts;
const AVAX = X402_PERMIT2_ASSETS[0]!;

/** Offline stand-in for the facilitator's chain reads: the token is deployed, the payer is an EOA and the settle simulation is recorded. */
function referenceSigner(payer: Address) {
  const simulations: { functionName: string; args: readonly unknown[] }[] = [];
  const signer = {
    getAddresses: () => [],
    getCode: async ({ address }: { address: Address }) => address.toLowerCase() === AVAX.token.toLowerCase() ? "0x6080" : "0x",
    readContract: async (call: { address: Address; functionName: string; args: readonly unknown[] }) => {
      assert.equal(call.address, X402_EXACT_PERMIT2_PROXY);
      simulations.push({ functionName: call.functionName, args: call.args });
      return undefined;
    },
  };
  assert.notEqual(payer, AVAX.token);
  return { signer, simulations };
}

for (const sponsored of [false, true]) {
  test(`the x402 reference facilitator accepts APN's Permit2 payload (${sponsored ? "with" : "without"} the EIP-2612 permit)`, async () => {
    const key = generatePrivateKey(), payer = privateKeyToAccount(key).address;
    const selection = selectPermit2Offer(ACCEPTS, payer);
    const plan = planPermit2Authorization(selection, { payer, nowSeconds: Math.floor(Date.now() / 1000), nonce: 42n,
      permit2AllowanceAtomic: sponsored ? "0" : selection.amountAtomic, eip2612Nonce: sponsored ? 0n : null, sellerSponsorsEip2612: sponsored });
    const payment = await assemblePermit2Payment(plan, { signPermit2Material: async (_address: Address, typedData: Permit2TypedData) =>
      await privateKeyToAccount(key).signTypedData(typedData as never) as Hex }) as { accepted: unknown };
    const { signer, simulations } = referenceSigner(payer);
    const verdict = await new ExactEvmScheme(signer as never).verify(payment as never, payment.accepted as never);
    assert.deepEqual(verdict, { isValid: true, invalidReason: undefined, payer });
    assert.equal(simulations.length, 1);
    assert.equal(simulations[0]!.functionName, sponsored ? "settleWithPermit" : "settle");
    const tampered = structuredClone(payment) as unknown as { payload: { permit2Authorization: { witness: { to: string } } } };
    tampered.payload.permit2Authorization.witness.to = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4";
    const refusal = await new ExactEvmScheme(signer as never).verify(tampered as never, payment.accepted as never);
    assert.equal(refusal.isValid, false);
    assert.equal(refusal.invalidReason, "invalid_permit2_recipient_mismatch");
  });
}

test("a live Base settleWithPermit receipt through the same proxy has exactly the layout the settlement proof requires", () => {
  const live = JSON.parse(readFileSync("tests/fixtures/x402-permit2/base-settle-with-permit-live.json", "utf8")) as {
    token: string; txSelector: string; txTo: string; receipt: { transactionHash: Hex; logs: { topics: string[]; data: string }[] } };
  const settleWithPermit = x402ExactPermit2ProxyABI.find((item) => item.type === "function" && item.name === "settleWithPermit")!;
  assert.equal(live.txSelector, toFunctionSelector(settleWithPermit as never));
  assert.equal(live.txTo.toLowerCase(), X402_EXACT_PERMIT2_PROXY.toLowerCase());
  const transfer = live.receipt.logs.find((log) => log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")!;
  const expected = { listAsset: { ...AVAX, token: getAddress(live.token) as Address }, payer: getAddress(`0x${transfer.topics[1]!.slice(26)}`) as Address,
    payTo: getAddress(`0x${transfer.topics[2]!.slice(26)}`) as Address, amountAtomic: BigInt(transfer.data).toString(),
    transactionHash: live.receipt.transactionHash, withPermit: true };
  assert.equal(verifyPermit2SettlementReceipt(live.receipt, expected).settledEvent, "SettledWithPermit");
  assert.throws(() => verifyPermit2SettlementReceipt(live.receipt, { ...expected, withPermit: false }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_X402_SETTLEMENT_INVALID");
});
