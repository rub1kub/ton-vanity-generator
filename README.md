# TonSuite TON Vanity Generator

A privacy-first vanity address generator for TON Wallet W5 and v4R2. It runs
entirely in the browser at [`tonsuite.org/generator/`](https://tonsuite.org/generator/).

## What it does

- Searches for a user-chosen ending in a URL-safe TON friendly address.
- Supports mainnet W5 v5r1 and Wallet v4R2.
- Supports non-bounceable `UQ…` and bounceable `EQ…` display formats.
- Uses the current TEP-3 12-word BIP39 format and `m/44'/607'/0'` path.
- Runs work in multiple dedicated Web Workers.
- Can pause, resume and change CPU/GPU power without losing the attempt count.
- Offers one compact, local auto-tune control that benchmarks the full pipeline
  and applies the fastest tested CPU/GPU configuration for that browser.
- Runs several parallel WebGPU pipelines, including BIP39 PBKDF2 and the
  complete SLIP-0010 `m/44'/607'/0'` derivation in WGSL.
- Detects mobile browsers, hides WebGPU there, and exposes every safe CPU count
  up to the browser-reported ceiling (8 on mobile, 32 on desktop).
- Keeps generation, candidate keys and recovery words on the user's device.
- Makes no analytics or wallet API requests.
- Plays a local Web Audio chime and, when the user grants browser permission,
  shows a system notification after a matching wallet is found.

## Important limits

Vanity search is probabilistic. A case-sensitive suffix of length `L` needs
about `64^L` candidates on average. Ignoring letter case reduces that to about
`32^L` for all-letter suffixes. BIP39/SLIP-0010 derivation is still non-trivial,
so long endings can take days, months or longer even with several workers. The
UI reports the measured speed rather than promising a deadline.

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
- WebGPU accelerates BIP39 PBKDF2-HMAC-SHA512 plus SLIP-0010 in self-tested
  batches. The original BIP39 root-seed API and known-answer test remain.
- The ordinary `libsodium-wrappers` WASM build accelerates Ed25519 public-key
  derivation, with an RFC 8032 self-test and automatic noble fallback.
- Canonical W5/v4R2 contract code is cached once; only the small data Cell and
  StateInit address are built for each candidate.
- Every winning GPU candidate is independently re-derived from its mnemonic on
  the CPU before the address or recovery phrase is accepted. CPU winners are
  independently re-derived through the canonical path as well.
- Each worker loops independently and sends only aggregate progress to the UI.
- Found-wallet notifications contain no address, mnemonic or other secret.
- Telegram TGS animations are self-hosted and rendered with the light Lottie
  player; no Telegram or FStik request is made at runtime.

## Open-source and assets

Original source code is MIT licensed. Utya sticker artwork is third-party and is
not covered by the MIT license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for sources and identifiers.

This project is independent and is not endorsed by TON Foundation, Telegram or
the wallet applications whose import formats it supports.
