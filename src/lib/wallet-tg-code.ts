import { beginCell, Cell } from '@ton/ton';
import { Buffer } from 'buffer';

// ton-blockchain/tg-wallet-contract @ 1a29ae5d90e03c3d585d3e42e6ecef691d727a3c.
export const TG_WALLET_ID = 0x7fff7f11; // Mainnet, workchain 0; NOT the W5 ID.
export const TG_CODE_HASH = '9149ae51c1e4689710cebf7830297b16acfbadb363a920a537893e7ffeeca768';
export const TG_IMPLEMENTATION_HASH = 'e30911420bef1191c09dce58b9df2b4ca4c2d9c383cc3b6a91170349ffa70e2c';

export function telegramWalletCode(): Cell {
  const code = Cell.fromBoc(Buffer.from('b5ee9c7241010101001a000030ff00209821d7498308b9f240df8085f833d0ed1e20ed53d969427e39', 'hex'))[0];
  if (code?.hash().toString('hex') !== TG_CODE_HASH) throw new Error('Invalid WalletTg trampoline.');
  return code;
}

export function telegramWalletData(publicKey: Uint8Array): Cell {
  if (publicKey.length !== 32) throw new Error('Invalid public key length.');
  return beginCell().storeUint(0, 8).storeUint(0, 32).storeUint(TG_WALLET_ID, 32)
    .storeBuffer(Buffer.from(publicKey), 32).endCell();
}
