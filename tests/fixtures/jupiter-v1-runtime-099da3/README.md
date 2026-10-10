# Jupiter runtime 099da3 test bytes

`programdata.bin.gz` contains the full public ProgramData account for JUP6,
`4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT`. Independent reads from
`https://solana-rpc.publicnode.com` and `https://api.mainnet-beta.solana.com`
on 8 October 2026 at 16:11:59–16:12:02 UTC returned identical 2,892,269 bytes.
Both origins validated the mainnet genesis and canonical executable Program pointer.

The payload SHA256 is `099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f`.
The complete account SHA256 is `3bd95cf0775979fdaed8a383474461d538a6ef040303f161abf9ed8c40dbc517`.
Deployment slot is `454465850`. The deterministic gzip SHA256 is
`1fd92282f850b60a1217839021427e99c8a745dc51fe1da370021735e2c3b4b9`.

These are runtime bytes, without a source-build attestation. They are never executed locally.
The helper combines them with historical Fp market accounts and modeled slots,
fee and height. Tests using that model do not establish fresh mainnet simulation,
signature, send or finalized swap.
