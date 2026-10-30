WalletTg rev00 bytecode is vendored only for offline interoperability tests.

Source: [ton-blockchain/tg-wallet-contract](https://github.com/ton-blockchain/tg-wallet-contract/tree/1a29ae5d90e03c3d585d3e42e6ecef691d727a3c).
Original path: `contracts/revisions-boc/WalletTg-rev00.boc`.
Root hash: `e30911420bef1191c09dce58b9df2b4ca4c2d9c383cc3b6a91170349ffa70e2c`.
The upstream MIT license is included here.

These tests feed complete external messages produced by the browser's TypeScript
serializer into this bytecode through the canonical trampoline/config -123.
They use public BIP39 test vectors, never real funds or recovery phrases.
