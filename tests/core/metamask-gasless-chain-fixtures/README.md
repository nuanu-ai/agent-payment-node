# MetaMask gasless chain fixtures

`base-signed-vector.json` is an offline, deterministic Base vector. It uses the
synthetic secp256k1 keys `0x11…11` for the owner and `0x22…22` for the relayer.
The generator directly constructs the two ERC-20 calls, the delegation struct
hash, EIP-712 digest, ABI permission context, `redeemDelegations` calldata, and
signed EIP-1559/EIP-7702 transactions with viem standards primitives. It does
not import the APN encoder, contact a provider, or read an account. SHA-256:
`a9c91a0983c6a3dfa838af98d7e1c260b58ad0fa4ad479ce355ef3dfa54434c2`.

`runtime-code.json` copies the frozen public deployment runtime bytes and token
implementation bytes, then content-deduplicates them by SHA-256. Its embedded
provenance records the three exact source paths and source hashes. The fixture
contains all eight admitted chain rows. SHA-256:
`f37646220871b16931912855b8e5eb0a6627318378e7c132dabd165815364682`.

These fixtures are static verifier inputs. They do not prove current mainnet
state or live payment acceptance.
