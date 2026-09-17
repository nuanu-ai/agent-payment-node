# Dormant TRON SunSwap surface

APN exposes `inventory`, `quote`, `prepare`, `status`, `approve`, and `execute`
under `apn swap tron sunswap`. The offline inventory freezes TRON mainnet,
native TRX, canonical USDT, the SunSwap V4 Universal Router, Pool Manager,
Permit2, quote endpoint, official source hashes, and encoding policy. Inventory
presence reports `admitted: false` and grants no spending authority.

`quote` can run only when the caller explicitly injects a read-only builder.
The shipped CLI and MCP runtime install no builder or network provider. The
binder requires canonical TRON base58check identities, a positive atomic SUN
amount, and canonical slippage integers within the owner cap.

`prepare` refuses until the owner separately admits both exact assets and the
mechanism. Native TRX has no TRC20 or Permit2 approval, so `approve` always
returns `sunswap_native_no_approval`. `execute` returns
`sunswap_execution_dormant`; APN installs no signer, sender, or observer.
`status` only reads an existing guarded swap operation from local durable
state and never resumes or submits it.
