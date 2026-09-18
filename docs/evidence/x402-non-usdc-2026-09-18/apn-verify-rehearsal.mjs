// Read-only rehearsal through APN's own x402-permit2 modules: select -> plan -> assemble -> POST /verify (never /settle).
// The payer is an ephemeral in-memory key that never held funds; its key is never written anywhere.
import { writeFileSync } from "node:fs";
// Run from the repository root after `npm run build:test`: node docs/evidence/x402-non-usdc-2026-09-18/apn-verify-rehearsal.mjs <out.json>
const WT = process.cwd();
const { generatePrivateKey, privateKeyToAccount } = await import(`${WT}/node_modules/viem/_esm/accounts/index.js`);
const { selectPermit2Offer } = await import(`${WT}/dist-test/src/x402-permit2/offer.js`);
const { planPermit2Authorization, assemblePermit2Payment } = await import(`${WT}/dist-test/src/x402-permit2/authorization.js`);
const { PERMIT2_ADDRESS } = await import(`${WT}/dist-test/src/x402-permit2/registry.js`);
const OUT = process.argv[2];
const RPC = "https://api.avax.network/ext/bc/C/rpc", VERIFY = "https://facilitator.payai.network/verify";
const key = generatePrivateKey(), account = privateKeyToAccount(key), payer = account.address;
const payTo = privateKeyToAccount(generatePrivateKey()).address;
const offer = { scheme: "exact", network: "eip155:43114", asset: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", amount: "1", payTo,
  maxTimeoutSeconds: 60, extra: { assetTransferMethod: "permit2", name: "TetherToken", version: "1" } };
async function call(to, data) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
  return (await r.json()).result;
}
const word = (a) => a.slice(2).toLowerCase().padStart(64, "0");
const token = offer.asset;
const allowance = BigInt(await call(token, `0xdd62ed3e${word(payer)}${word(PERMIT2_ADDRESS)}`)).toString();
const eip2612Nonce = BigInt(await call(token, `0x7ecebe00${word(payer)}`));
const balance = BigInt(await call(token, `0x70a08231${word(payer)}`)).toString();
const signer = { signPermit2Material: async (_address, typedData) => await account.signTypedData(typedData) };
const selection = selectPermit2Offer([offer], payer);
const nonce = BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`);
const cases = [];
for (const sponsored of [false, true]) {
  // Without sponsorship the plan refuses a short allowance; force the Permit2-only payload by stating the exact amount as allowance.
  const plan = planPermit2Authorization(selection, { payer, nowSeconds: Math.floor(Date.now() / 1000), nonce: nonce + (sponsored ? 1n : 0n),
    permit2AllowanceAtomic: sponsored ? allowance : selection.amountAtomic, eip2612Nonce: sponsored ? eip2612Nonce : null, sellerSponsorsEip2612: sponsored });
  const paymentPayload = await assemblePermit2Payment(plan, signer);
  const body = { x402Version: 2, paymentPayload, paymentRequirements: paymentPayload.accepted };
  const startedAt = new Date().toISOString();
  const response = await fetch(VERIFY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  cases.push({ case: sponsored ? "apn_plan_permit2_with_eip2612GasSponsoring" : "apn_plan_permit2_only", startedAt, endpoint: VERIFY, request: body,
    status: response.status, response: JSON.parse(text) });
  console.log(sponsored, response.status, text);
}
writeFileSync(OUT, JSON.stringify({ observedAt: new Date().toISOString(),
  note: "APN x402-permit2 modules built the payloads; ephemeral unfunded payer and payee; POST /verify only; key discarded.",
  chainReads: { rpc: RPC, payer, payerUsdtBalanceAtomic: balance, permit2AllowanceAtomic: allowance, eip2612Nonce: eip2612Nonce.toString() }, cases }, null, 2));
