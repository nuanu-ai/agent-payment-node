# Guarded Ethereum Uniswap swap

APN bundles one immutable official catalog for Ethereum chain 1, Universal
Router 2.2.0, Permit2, the Uniswap Trading API, and the first exact input pair:
native ETH to canonical Ethereum USDC. Catalog presence does not admit either
asset and does not authorize signing or execution.

`swap ethereum uniswap inventory` is offline. `quote` requires an explicitly
installed Trading API and Ethereum RPC adapter. It fixes `permitAmount` to
`EXACT`, requires native input with no token approval, decodes the unsigned
Universal Router `execute` calldata, and accepts only a WRAP_ETH followed by a
V2 or V3 exact input command. Extensions, subplans, arbitrary transfers, weak
recipient binding, and unsupported commands fail closed. The same unsigned
envelope must pass `eth_call` and `eth_estimateGas` at one rechecked safe block
within the recorded head drift bound.

Preparation additionally requires separate owner admission of both exact
assets and the catalog mechanism under the shared usage ledger. The shipped
runtime contains no active admission and no Uniswap signer or sender.
`prepare`, `approve`, and `execute` therefore return stable classified
refusals. `status` is observation only. The lower level guarded operation core
persists its submission marker before any possible send and never broadcasts a
second time after an unknown result.

The receipt validator requires status 1, the exact transaction hash and
unsigned envelope, router destination, native debit and USDC balance deltas, a
USDC Transfer credit to the recipient at or above the minimum output, and a
finalized head at or beyond the receipt block.
