# Design QA — TON Vanity Generator

## Evidence

- Source visual truth: MyTonWallet / Gram Wallet dark interface at `https://wallet.ton.org/`.
- Source capture: `docs/design-qa/mytonwallet-reference-1280x720.png`.
- Implementation capture: `docs/design-qa/generator-final-desktop-1280x720.png`.
- Same-input comparison: `docs/design-qa/reference-vs-final-2576x720.png`.
- Responsive evidence: `docs/design-qa/generator-final-mobile-390x844.png`.
- Advanced-open evidence: `docs/design-qa/generator-advanced-open-1280x720.png`.
- Mobile footer evidence: `docs/design-qa/generator-footer-mobile-390x844.png`.
- Desktop viewport: 1280 × 720 CSS pixels, DPR 1, setup state, dark theme.
- Mobile viewport: 390 × 844 CSS pixels, DPR 1, setup state, dark theme.

The full-size comparison keeps both 1280 × 720 captures readable in a single image, so a separate focused crop was not required. The responsive capture separately verifies the narrow layout and above-the-fold CTA.

## Fidelity review

- Typography: compact wallet-style hierarchy, high-weight display heading, readable secondary copy.
- Color and surface: near-black background, restrained blue accent, dark elevated card, subtle borders and glow.
- Shape and spacing: rounded controls, segmented wallet selector, compact settings card, prominent full-width CTA.
- Brand assets: TonSuite eyes mark is used for the favicon and navigation; Telegram Utya TGS remains the hero artwork.
- Product adaptation: the desktop layout intentionally uses two columns to keep generator settings and the primary CTA visible within 720 px while retaining the reference's centered, minimal wallet aesthetic.
- Copy: public presets are `GRAM`, `MONEY`, `TON`, and `DUCK`; custom typed input such as `DICK` remains valid.

## Iteration history

1. Initial desktop composition placed the CTA below a 720 px viewport (P2).
2. The setup screen was changed to a compact two-column desktop layout, with threads, case, and address format collapsed under Advanced.
3. Final desktop evidence places the CTA at approximately y=509–559 with no horizontal or vertical overflow.
4. Final mobile evidence has no horizontal overflow and keeps the CTA visible above the initial fold.

## Interaction and accessibility checks

- Russian and English direct routes render with localized title, metadata, canonical URL, navigation, and generator copy.
- Language switching preserves an active search, found candidate, and revealed/hidden seed state.
- GPU search, CPU Maximum mode, cancellation, candidate confirmation, explicit seed reveal, and hiding were exercised in-browser.
- Seed words are absent from the React DOM until the safe-place confirmation and explicit reveal action.
- The revealed-seed screen has no destructive Back control; hiding removes all 12 words from the DOM, while the explicit restart returns to a clean setup state.
- Primary controls meet a 44 px minimum target; visible keyboard focus, semantic pressed states, stronger muted-text contrast, and reduced-motion behavior are present.
- Browser console reported no errors in desktop, mobile, CPU, GPU, or direct-English-route checks.

## GPU and layout regression check

- Production-build benchmark input: W5, non-bounceable, case-sensitive `GRAMGRAM` ending, same browser and machine.
- CPU baseline: 7 workers, approximately 451 complete TON addresses per second after 15 seconds.
- GPU result: 7 parallel WebGPU pipelines, approximately 2,193–2,464 complete TON addresses per second across repeated 20–50 second runs (about 4.9–5.5× the CPU baseline).
- The throughput counter increments only after PBKDF2, SLIP-0010, Ed25519, StateInit, and friendly-address formatting are complete.
- With Advanced closed and open at 1280 × 720, the setup hero remained at y=106 and the Utya sticker at y=154; no horizontal movement or overflow was measured.
- At 390 × 844 the footer uses a centered two-row layout and has no horizontal overflow.

## Remaining observations

- WebGPU availability and throughput depend on the browser, operating system, and graphics driver; automatic CPU fallback is part of the intended behavior.
- The Utya animation is a deliberate brand-specific substitution rather than a literal copy of MyTonWallet artwork.

final result: passed
