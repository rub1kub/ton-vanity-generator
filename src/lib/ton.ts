import { generateMnemonic, mnemonicToSeedWebcrypto } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveEd25519Path, keyPairFromSeed } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { Buffer } from 'buffer';

import type { AddressFormat, WalletVersion } from '../types';

const BIP39_STRENGTH_BITS = 128;
const TON_DERIVATION_PATH = [44, 607, 0];
const MAINNET_GLOBAL_ID = -239;
const BASECHAIN_WORKCHAIN = 0;

type TonKeyPair = ReturnType<typeof keyPairFromSeed>;
export type TonPublicKey = TonKeyPair['publicKey'];

export interface WalletCandidate {
  address: string;
  mnemonic: string[];
}

/**
 * Produces the canonical mainnet address for the selected wallet contract.
 *
 * v4 uses the Wallet V4R2 contract's standard wallet id. W5 uses the
 * standard mainnet v5r1 client context (workchain 0, subwallet 0).
 */
export function walletAddressFromPublicKey(
  publicKey: TonPublicKey,
  version: WalletVersion,
  addressFormat: AddressFormat,
): string {
  if (publicKey.length !== 32) {
    throw new Error('A TON Ed25519 public key must be exactly 32 bytes.');
  }

  const wallet =
    version === 'v4r2'
      ? WalletContractV4.create({
          workchain: BASECHAIN_WORKCHAIN,
          publicKey,
        })
      : WalletContractV5R1.create({
          publicKey,
          walletId: {
            networkGlobalId: MAINNET_GLOBAL_ID,
            context: {
              walletVersion: 'v5r1',
              workchain: BASECHAIN_WORKCHAIN,
              subwalletNumber: 0,
            },
          },
        });

  return wallet.address.toString({
    bounceable: addressFormat === 'bounceable',
    testOnly: false,
    urlSafe: true,
  });
}

/**
 * Generates the 12-word TEP-3 multichain mnemonic used by current TON wallets,
 * derives m/44'/607'/0' with SLIP-0010 Ed25519 and creates the requested
 * default contract address. Secret byte buffers are zeroed on a best-effort
 * basis after derivation; immutable JavaScript strings remain subject to GC.
 */
export async function generateWalletCandidate(
  version: WalletVersion,
  addressFormat: AddressFormat,
): Promise<WalletCandidate> {
  const mnemonicText = generateMnemonic(wordlist, BIP39_STRENGTH_BITS);
  const mnemonic = mnemonicText.split(' ');
  let rootSeed: Uint8Array | undefined;
  let rootSeedBuffer: Buffer | undefined;
  let derivedSeed: Buffer | undefined;
  let keyPair: TonKeyPair | undefined;

  try {
    rootSeed = await mnemonicToSeedWebcrypto(mnemonicText);
    rootSeedBuffer = Buffer.from(rootSeed);
    derivedSeed = await deriveEd25519Path(
      rootSeedBuffer,
      TON_DERIVATION_PATH,
    );
    keyPair = keyPairFromSeed(derivedSeed);

    return {
      address: walletAddressFromPublicKey(
        keyPair.publicKey,
        version,
        addressFormat,
      ),
      mnemonic,
    };
  } finally {
    rootSeed?.fill(0);
    rootSeedBuffer?.fill(0);
    derivedSeed?.fill(0);
    keyPair?.secretKey.fill(0);
  }
}
