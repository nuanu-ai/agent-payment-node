import type { MetaMaskGaslessClock } from "./clock.js";
import { mmAssertStableQuote, mmEconomics, mmQuote } from "./economics.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessQuote, MetaMaskGaslessRequest } from "./model.js";
import type { MetaMaskGaslessProviderPort } from "./ports.js";
import { mmRegistry } from "./registry.js";
import { mmFail } from "./reasons.js";

export async function metaMaskGaslessQuote(provider: MetaMaskGaslessProviderPort, binding: MetaMaskGaslessBinding,
  request: MetaMaskGaslessRequest, rpcUrl: string, clock: MetaMaskGaslessClock): Promise<MetaMaskGaslessQuote> {
  const { gross, initialNet } = mmEconomics(request), token = mmRegistry(request.chainId).row.token;
  let netAtomic = initialNet.toString();
  for (let attempt = 0; attempt < 3; attempt++) {
    clock.check();
    const value = await provider.quote({ binding, chainId: request.chainId, token,
      recipient: request.recipient, netAtomic, rpcUrl });
    clock.check();
    const quote = mmQuote(value, request, binding, netAtomic);
    if (BigInt(netAtomic) + BigInt(quote.feeAtomic) === gross) {
      mmAssertStableQuote(request, quote);
      return quote;
    }
    netAtomic = (gross - BigInt(quote.feeAtomic)).toString();
  }
  return mmFail("mm_gasless_quote_unstable");
}
