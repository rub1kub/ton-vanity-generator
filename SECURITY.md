# Security

## Reporting

Please report security issues privately to the repository owner instead of
opening a public issue containing exploit details or a recovery phrase.

Never send a real seed phrase in a bug report.

## Security model

- Wallet candidates are generated in dedicated Web Workers.
- The generator has no backend API, analytics, account system or persistence.
- Seed phrases are not written to logs, URLs, cookies, Local Storage or
  IndexedDB.
- Sticker, font and JavaScript assets are served from the same origin.
- Closing or restarting the page destroys the only in-memory copy of an
  unsaved generated wallet.

Browser JavaScript cannot promise perfect memory zeroization because garbage
collection is implementation-defined. For meaningful funds, verify the source,
use an offline copy on a trusted device and test recovery before depositing.
