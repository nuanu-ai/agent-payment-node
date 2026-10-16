# Whirlpool runtime c422b2 test bytes

`programdata.bin.gz` contains the full public ProgramData account of the Orca
Whirlpool program `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`, at
`CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD`, after its upgrade on
15 October 2026.

Two independent origins returned identical 10,485,760 bytes on 16 October 2026,
each read in seven 1,500,000-byte `dataSlice` chunks after a mainnet genesis
check:

- `https://api.mainnet-beta.solana.com` at about 07:28 UTC, context slots 457553883–457553959;
- `https://solana-rpc.publicnode.com` at about 07:45 UTC, context slots 457558591–457558651.

| Fact | Value |
| --- | --- |
| Deployment slot (header) | `457152296`, block time 2026-10-15 07:22:05 UTC |
| Upgrade authority | `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV` (Squads v4 vault, unchanged) |
| Upgrade transaction | `2Z156jvtGjumG6tAEqfMqctBRuh8YmNb5UbQzkqbnAw6xR4TtFgUC4DW8tykwgcibPfeyiEigZQ3x1Pp1kHNwzGT` (Squads `VaultTransactionExecute` → loader `Upgrade`, buffer `GFAGqhnRdPaoyft7fNyoxxXEhwDQpxsc3j77wV7Wa2TW`) |
| Header SHA-256 (bytes 0–44) | `fabfdb127c040782f2ba077df7cbc62185c14a036c8d136e0fed4fac3e7f1bdf` |
| Payload SHA-256 (bytes 45+) | `c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f` |
| Complete account SHA-256 | `a49ebc534880f4aaf525b5fd1504aed6223928bdbbea6c83d40473eb17abd04e` |
| Executable hash (`solana-verify get-program-hash`, trailing zeros trimmed) | `75d0cbf14e39949d50656d581b2e0065ac9543588da96a1dc4c1091a939c605c` |
| Deterministic gzip (`gzip -9 -n`) SHA-256 | `68b75585c33a9c510bc7a7e8f972e16f410024773bc1237df4e4c817febe6cfe` |

The previous generation, deployed at slot 440170207, had header
`88fc1d0d…4ee1814`, payload `610b1e39…c350f9ae`, complete account
`b5ee20ce…58048fa0` and executable hash `46328660…10154992`. Its bytes remain
in `../jupiter-v1-live-simulation-83/capture.json.gz` and
`../jupiter-v1/diagnostic-v1-public-capture.json.gz`.

These are runtime bytes, without a source-build attestation. The OtterSec
registry reports this executable hash as not verified. They are never executed
locally. `material.ts` combines them with historical pool accounts and modeled
slots, fee and height. Tests using that model do not establish fresh mainnet
simulation, signature, send or a finalized swap.
