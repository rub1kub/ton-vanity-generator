# TonSuite TON Vanity Generator

A privacy-first vanity address generator for Telegram WalletTg, W5 and v4R2. It runs
entirely in the browser at [`tonsuite.org/generator/`](https://tonsuite.org/generator/).

## What it does

- Searches for one or more comma-separated endings (for example `PUMP, GRAM, DIMA`)
  in a URL-safe TON friendly address. Any ending can win. Example chips toggle
  independently; case matching applies to each ending as typed or ignores case.
- Supports mainnet Telegram WalletTg (rev00), W5 v5r1 and Wallet v4R2.
- Supports non-bounceable `UQ…` and bounceable `EQ…` display formats.
- Lets the user choose the recommended 12-word TEP-3 Multichain format
  (`m/44'/607'/0'`) or the classic 24-word TON mnemonic format.
- WalletTg generation uses the initial 12-word BIP39 rotation format. The UI selects
  the non-bounceable `UQ…` format used by Telegram so its displayed ending matches.
- Runs work in multiple dedicated Web Workers.
- Can pause, resume and change CPU/GPU power without losing the attempt count.
- Offers one compact, local auto-tune control that benchmarks the full pipeline
  and applies the fastest tested CPU/GPU configuration for that browser.
- Runs several parallel WebGPU pipelines, including BIP39 PBKDF2 and the
  complete SLIP-0010 `m/44'/607'/0'` derivation in WGSL.
- Detects mobile browsers, hides WebGPU there, and exposes every safe CPU count
  up to the browser-reported ceiling (8 on mobile, 32 on desktop).
- Keeps generation, candidate keys and recovery words on the user's device.
- Makes no analytics requests; vanity generation needs no wallet API.
- Rotates WalletTg signing keys on-chain while retaining the vanity address,
  even when Telegram does not expose a phrase-update button.
- Plays a local Web Audio chime and, when the user grants browser permission,
  shows a system notification after a matching wallet is found.

## Important limits

Vanity search is probabilistic. A case-sensitive suffix of length `L` needs
about `64^L` candidates on average. Ignoring letter case reduces that to about
`32^L` for all-letter suffixes. BIP39/SLIP-0010 derivation is still non-trivial,
so long endings can take days, months or longer even with several workers.
Multiple distinct endings improve the odds; the estimate counts duplicates and
overlapping endings only once.
Classic 24-word TON mnemonics use a substantially heavier KDF and therefore
search more slowly than the default 12-word mode. The UI reports measured speed
rather than promising a deadline.

Never fund a generated wallet before you have safely recorded the recovery
phrase and tested that it restores the same address in a compatible wallet.

## Local development

Requirements: Node.js 22.12 or newer.

```bash
npm ci
npm run dev
```

The app is mounted under `/generator/`, matching production. Production build:

```bash
npm run test:run
npm run build
```

Static output is written to `dist/`.

## Architecture

- React + TypeScript + Vite for the UI.
- A specialized CSPRNG-backed 128-bit BIP39 encoder creates 12-word English
  mnemonics and is differential-tested against `@scure/bip39`.
- A separate CSPRNG-backed generator creates classic 24-word TON mnemonic
  candidates, performs the TON basic-seed check, and derives `TON default seed`.
- WebGPU accelerates BIP39 PBKDF2-HMAC-SHA512 plus SLIP-0010 in self-tested
  batches, as well as the TON-specific 24-word validation and 100,000-round
  derivation. Both paths use known-answer tests.
- The ordinary `libsodium-wrappers` WASM build accelerates Ed25519 public-key
  derivation, with an RFC 8032 self-test and automatic noble fallback.
- Canonical WalletTg/W5/v4R2 contract code is cached once; only the small data Cell and
  StateInit address are built for each candidate.
- Every winning GPU candidate is independently re-derived from its mnemonic on
  the CPU before the address or recovery phrase is accepted. CPU winners are
  independently re-derived through the canonical path as well.
- Each worker loops independently and sends only aggregate progress to the UI.
- Found-wallet notifications contain no address, mnemonic or other secret.
- Telegram TGS animations are self-hosted and rendered with the light Lottie
  player; no Telegram or FStik request is made at runtime.

## Telegram WalletTg

Select **tgWallet · Telegram**, search, then save the 12-word phrase. Import it
into Telegram's native **Money** wallet or another app that supports WalletTg
and the TEP-3 rotation mnemonic. Verify the same address before funding it.
This is the native WalletTg contract, not a generic import into any Wallet mini app.

Addresses use the immutable trampoline from
[`ton-blockchain/tg-wallet-contract`](https://github.com/ton-blockchain/tg-wallet-contract/tree/1a29ae5d90e03c3d585d3e42e6ecef691d727a3c),
code hash `9149ae51c1e4689710cebf7830297b16acfbadb363a920a537893e7ffeeca768`,
and rev00 data: `revision:uint8=0`, `seqno:uint32=0`,
`subwalletId:uint32=0x7FFF7F11`, `anchorPublicKey:bits256`, on workchain 0.
The address fixtures in `src/lib/fixtures/wallet-tg.json` were independently
produced with `i582/wallet-engine` commit `e59e0d89d7ee90c388bf36e3334c5b276f396697`.

WalletTg can rotate its signing key on-chain without changing its address or
vanity ending. After the first successful rotation, the current phrase has 24
words: the original 12-word anchor and an independent 12-word signing half.
Only the signing half changes on later rotations; old phrases no longer sign.
Open **Change a tgWallet recovery phrase** (or `/generator/#rotate`) to submit a
key change directly. Enter the original address and current 12/24-word phrase,
save the new 24-word phrase, and answer the backup check before signing.
The wallet needs TON for fees; a prefunded undeployed wallet can be deployed and
rotated together. Fees are estimated before approval and checked again before
signing. The displayed tolerance is not an on-chain maximum fee.

Keep both phrases until the on-chain key confirms success. Network errors do not
prove failure. Only public pending metadata is saved for checking after reload;
words and private keys are never persisted or sent to the RPC. Import the new
24 words into Telegram and update any old backup/connection afterwards.

The production proxy exposes only `getAddressInformation`, `getConfigParam`,
`estimateFee` and `sendBoc`. Templates are in `ops/`; the TON Center key belongs in
the root-readable server include, never JavaScript or a `VITE_*` variable.
Local `npm run dev` / `preview` proxies to the public endpoint without a key.
Self-hosted static copies retain generation; online rotation needs the RPC proxy.

Run focused tests with `npx vitest run src/lib/tg-rotation*.test.ts` and contract
interoperability tests with `npm run test:rotation-contract` (Acton 1.2.0; optional
`ACTON_BIN=/path/to/acton`). These emulate actual TypeScript-produced BOCs against
pinned WalletTg bytecode; they never use real funds. See [SECURITY.md](SECURITY.md), the
[Telegram wallet guide](https://docs.ton.org/onboarding/wallet-apps/telegram) and
[WalletTg integration specification](https://docs.ton.org/contracts/standard/wallets/telegram/integrate).

## Open-source and assets

Original source code is MIT licensed. Utya sticker artwork is third-party and is
not covered by the MIT license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for sources and identifiers.

This project is independent and is not endorsed by TON Foundation, Telegram or
the wallet applications whose import formats it supports.
