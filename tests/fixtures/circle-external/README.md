# Public external Circle fixtures

`actual-monad-external-receipt.json` captures public Monad chain 143 RPC transaction, receipt and canonical block for `0xa960a09b6abb91ab9cc8c847d5846266cb84b83d617e162b052c60640a28a961`. The authenticated legacy transaction uses protected v=322. Its recipient is the fixed Circle USDC recipient, with principal 40100, issuer fee 5 and net 40095. No custody or signed private material is present.

`pinned-public-code.json` contains public proxy and implementation bytecode read from the fixed Arbitrum and Monad deployment addresses. Tests verify these against production pins. Synthetic isolated journal/network fixtures use test-only keys and temporary ledgers; no real profile or ledger is loaded.
