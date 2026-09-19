// Read-only mainnet rehearsal of gasless USDT on Ethereum, up to the first signature.
// It loads no key, reads no APN state, signs nothing and sends nothing. It runs the engine's production adapters:
// pinned public HTTPS, the keyless Pimlico endpoint and the owner's explicit APN_ETHEREUM_RPC_URL.
//
//   APN_ETHEREUM_RPC_URL=<https-url> node scripts/gasless-usdt-rehearsal.mjs \
//     --sender <address> --to <address> --amount <USDT> --max-fee <USDT> --min-received <USDT>
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), "dist");
const { GaslessHttps } = await import(join(dist, "gasless/https.js"));
const { gaslessAddress, gaslessDecimal } = await import(join(dist, "gasless/validation.js"));
const { assertUsdtFunding, quoteUsdtGasless, sponsorUsdtOperation } = await import(join(dist, "gasless-usdt/engine.js"));
const { USDT_GASLESS } = await import(join(dist, "gasless-usdt/model.js"));
const { usdtChainPort, usdtSponsorPort } = await import(join(dist, "gasless-usdt/rpc.js"));

const usdtDisplay = (atomic) => {
  const scale = 10n ** BigInt(USDT_GASLESS.decimals), whole = atomic / scale, fraction = (atomic % scale).toString().padStart(USDT_GASLESS.decimals, "0").replace(/0+$/u, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
};

const FLAGS = ["--sender", "--to", "--amount", "--max-fee", "--min-received"];
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!FLAGS.includes(args[index]) || args[index + 1] === undefined || args[index] in options) throw new Error(`unexpected argument ${args[index]}`);
  options[args[index]] = args[index + 1];
}
for (const flag of FLAGS) if (options[flag] === undefined) throw new Error(`${flag} is required`);
const rpcUrl = process.env.APN_ETHEREUM_RPC_URL;
if (typeof rpcUrl !== "string" || rpcUrl === "") throw new Error("APN_ETHEREUM_RPC_URL is required; there is no default RPC");

const request = { sender: gaslessAddress(options["--sender"], "APN_INVALID_INPUT"), recipient: gaslessAddress(options["--to"], "APN_INVALID_INPUT"),
  grossAtomic: BigInt(gaslessDecimal(options["--amount"], USDT_GASLESS.decimals, true)),
  maxFeeAtomic: BigInt(gaslessDecimal(options["--max-fee"], USDT_GASLESS.decimals)),
  minReceivedAtomic: BigInt(gaslessDecimal(options["--min-received"], USDT_GASLESS.decimals, true)) };
const transport = new GaslessHttps();
const sponsor = usdtSponsorPort(transport), chain = usdtChainPort(transport, rpcUrl);
const show = (label, value) => process.stdout.write(`${label}: ${value}\n`);
const refusal = (step, error) => {
  show(`${step} refused`, `${error.code ?? "Error"} ${error.details?.reason ?? ""}`.trim());
  show(`${step} message`, error.message);
};

show("rehearsal", `${new Date().toISOString()} chain ${USDT_GASLESS.chainId}, sponsor ${USDT_GASLESS.bundlerUrl} (no API key)`);
const plan = await quoteUsdtGasless({ sponsor, chain }, request);
show("pins", "USDT, EntryPoint v0.8, 7702 delegate and Pimlico ERC-20 paymaster code hashes match; USDT fee 0, not paused");
show("quote.paymaster", plan.quote.paymaster);
show("quote.postOpGas", plan.quote.postOpGas.toString());
show("quote.exchangeRate (USDT atomic per 1e18 wei)", plan.quote.exchangeRate.toString());
show("quote.exchangeRateNativeToUsd", plan.quote.exchangeRateNativeToUsd.toString());
show("price.maxFeePerGas (fast)", `${plan.price.maxFeePerGas} wei`);
show("approval.gross", `${usdtDisplay(plan.request.grossAtomic)} (${plan.request.grossAtomic})`);
show("approval.feeCap (F, allowance to the sponsor)", `${usdtDisplay(plan.feeCapAtomic)} (${plan.feeCapAtomic})`);
show("approval.net (N, recipient credit)", `${usdtDisplay(plan.netAtomic)} (${plan.netAtomic})`);
show("approval.worstCaseQuotedFee", `${usdtDisplay(plan.quotedFeeAtomic)} (${plan.quotedFeeAtomic})`);
const account = await chain.account(request.sender);
show("account", `USDT ${account.usdtBalanceAtomic} atomic, EOA nonce ${account.eoaNonce}, EntryPoint nonce ${account.entryPointNonce}, delegation ${account.delegation}`);
try { assertUsdtFunding(plan, account); show("funding", "sufficient"); }
catch (error) { refusal("funding", error); }
try {
  const data = await sponsorUsdtOperation(sponsor, plan, account, BigInt(Math.floor(Date.now() / 1000)));
  show("sponsor.paymasterData", data);
} catch (error) { refusal("sponsor (pm_getPaymasterData)", error); }
show("boundary", "no key loaded, nothing signed, nothing sent, APN state not read");
