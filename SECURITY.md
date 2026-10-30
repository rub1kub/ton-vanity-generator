# Security

## Reporting

Please report security issues privately to the repository owner instead of
opening a public issue containing exploit details or a recovery phrase.

Never send a real seed phrase in a bug report.

## Security model

- Wallet candidates are generated in dedicated Web Workers.
- WebGPU buffers and derived seeds stay inside those workers; a winning GPU
  result is independently re-derived from its mnemonic before acceptance.
- Vanity generation has no backend API, analytics, account system or persistence.
- Seed phrases are not written to logs, URLs, cookies, Local Storage or
  IndexedDB.
- Optional system notifications contain only a generic found-wallet message;
  no address, suffix, mnemonic or key material is sent to the operating system.
- Sticker, font and JavaScript assets are served from the same origin.
- Closing or restarting the page destroys the only in-memory copy of an
  unsaved generated wallet.

## WalletTg key rotation

- Signing and mnemonic derivation run in a separate Web Worker. Recovery uses
  Telegram's 12 + 12 word format, not a TON 24-word or BIP39 24-word mnemonic.
- Only WalletTg rev00 on mainnet/workchain 0 with the canonical subwallet ID is
  supported. Before signing, check the anchor-derived address, current key,
  account bytecode, revision, and config -123 implementation at the account's
  masterchain block. Unknown versions fail closed.
- Public chain reads, unsigned fee estimates and the explicitly approved signed
  operation go through `/generator/rpc/` to TON Center. The API key stays in a
  root-readable server configuration outside the web root. No API key is bundled
  in JavaScript. The proxy permits only four methods, limits requests/body size,
  verifies upstream TLS and never retries broadcasts automatically.
- Fee estimation uses zero signatures and zero ciphertext with
  `ignore_chksig=true`; an estimate cannot authorize a key change. Final signing
  follows backup verification and a fresh key/state/fee check. Fee estimates are
  not a hard on-chain cap; a reserve is required.
- New signing words are generated independently with a CSPRNG. The first 12
  anchor words remain unchanged. The previous signing seed is encrypted using
  Telegram's `keyChangeSaltV1` scheme, retaining encrypted-comment history.
- Before broadcasting, persist an allowlisted **public** journal in Local
  Storage: network, address, anchor/old/new public keys, seqno, validity and
  message hash. It contains no words, private keys or signed BOC. Web Locks
  serialize submissions between tabs. Storage failure prevents broadcast.
- HTTP success is not chain confirmation, and an HTTP error is not proof of
  failure. Keep both phrases until the current on-chain key is verified. After
  reload, resume from the public journal; never create/rebroadcast another
  rotation automatically. Clear the journal only after a conclusive result and
  user acknowledgement. The user must keep an offline backup of all 24 words.
- RPC access logs and request-body logging are disabled in the supplied proxy
  deployment. Normal page access logs remain governed by the site's policy.

Run `npm run test:rotation-contract` with Acton 1.2.0 to emulate the exact
TypeScript-produced messages against pinned upstream bytecode. No test broadcasts
to mainnet/testnet. The Rust engine interoperability vector is from
`i582/wallet-engine@e59e0d89d7ee90c388bf36e3334c5b276f396697`.

Browser JavaScript cannot promise perfect memory zeroization because garbage
collection is implementation-defined. For meaningful funds, verify the source,
use an offline copy on a trusted device and test recovery before depositing.
