import { RotationError } from './tg-rotation-types';
import type { PendingRotation, RotationPreview } from './tg-rotation-types';
import { clearIdentity, hex, newTelegramSigner, rotationBody, rotationEnvelope, telegramIdentity } from './tg-rotation';
import type { TelegramIdentity } from './tg-rotation';
import { estimateRotationFee, readTelegramWallet } from './tg-rpc';
import type { RotationRpc, WalletSnapshot } from './tg-rpc';

export class RotationSession {
  private identity?: TelegramIdentity;
  private signer?: Awaited<ReturnType<typeof newTelegramSigner>>;
  private preview?: RotationPreview;
  private pending?: PendingRotation;
  private envelope?: Uint8Array;
  private sent = false;

  constructor(private readonly rpc: RotationRpc) {}

  dispose() {
    clearIdentity(this.identity); this.signer?.seed.fill(0); this.signer?.words.fill('');
    this.preview?.words.fill(''); this.envelope?.fill(0);
    this.identity = undefined; this.signer = undefined; this.preview = undefined; this.envelope = undefined;
  }

  async prepare(phrase: string, address: string): Promise<RotationPreview> {
    if (this.pending) throw new RotationError('busy');
    this.dispose();
    try {
      this.identity = await telegramIdentity(phrase, address);
      const snapshot = await this.read();
      if (snapshot.balance < 10_000_000n) throw new RotationError('balance');
      this.signer = await newTelegramSigner(this.identity);
      const body = this.body(snapshot, false);
      const fee = await estimateRotationFee(this.rpc, this.identity, body, snapshot.deploy);
      // Operational reserve, not a promise/cap on validator-charged fees.
      if (snapshot.balance < fee * 2n + 10_000_000n) throw new RotationError('balance');
      const indices = Array.from({ length: 12 }, (_, i) => i + 12);
      const random = crypto.getRandomValues(new Uint32Array(12));
      for (let i = 11; i > 0; i--) {
        const j = random[i] % (i + 1);
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      this.preview = {
        address: this.identity.address.toString({ bounceable: false }),
        words: [...this.identity.anchorWords, ...this.signer.words],
        fee: fee.toString(), balance: snapshot.balance.toString(), deploy: snapshot.deploy,
        quiz: indices.slice(0, 3).sort((a, b) => a - b),
      };
      return { ...this.preview, words: [...this.preview.words] };
    } catch (error) { this.dispose(); throw error; }
  }

  private async read(): Promise<WalletSnapshot> {
    if (!this.identity) throw new RotationError('internal');
    const snapshot = await readTelegramWallet(this.rpc, this.identity.address, this.identity.anchorPublicKey);
    if (snapshot.publicKey !== hex(this.identity.publicKey)) throw new RotationError('staleKey');
    if (snapshot.seqno >= 0xffffffff) throw new RotationError('wallet');
    return snapshot;
  }

  private body(snapshot: WalletSnapshot, sign: boolean, validUntil = Math.floor(Date.now() / 1000) + 300) {
    if (!this.identity || !this.signer) throw new RotationError('internal');
    return rotationBody({
      address: this.identity.address, oldSeed: this.identity.seed, newSeed: this.signer.seed,
      seqno: snapshot.seqno, validUntil, sign,
    });
  }

  async sign(answers: string[], approvedFee: string): Promise<PendingRotation> {
    if (this.pending) throw new RotationError('busy');
    if (!this.preview || !this.identity || !this.signer || answers.length !== 3
      || this.preview.quiz.some((position, i) => answers[i].trim().toLowerCase() !== this.preview!.words[position])) {
      throw new RotationError('phrase');
    }
    if (approvedFee !== this.preview.fee) throw new RotationError('feeChanged');
    const snapshot = await this.read();
    if (snapshot.deploy !== this.preview.deploy) throw new RotationError('stateChanged');
    const validUntil = Math.floor(Date.now() / 1000) + 300;
    const fee = await estimateRotationFee(this.rpc, this.identity, this.body(snapshot, false, validUntil), snapshot.deploy);
    // Even tiny storage-fee drift is normal. Stop if the estimate exceeds the
    // displayed estimate + 10% + 0.001 TON, a tolerance explicitly shown in UI.
    if (fee > BigInt(approvedFee) * 110n / 100n + 1_000_000n) throw new RotationError('feeChanged');
    if (snapshot.balance < fee * 2n + 10_000_000n) throw new RotationError('balance');
    if (Math.floor(Date.now() / 1000) > validUntil - 60) throw new RotationError('clock');
    const envelope = rotationEnvelope(this.identity, this.body(snapshot, true, validUntil), snapshot.deploy);
    this.pending = {
      version: 1, network: 'mainnet', address: this.preview.address,
      anchorPublicKey: hex(this.identity.anchorPublicKey), oldPublicKey: hex(this.identity.publicKey),
      newPublicKey: hex(this.signer.publicKey), seqno: snapshot.seqno, validUntil,
      messageHash: envelope.hash().toString('hex'),
    };
    this.envelope = new Uint8Array(envelope.toBoc());
    // User has backed up and checked the phrase; no further signing is needed.
    clearIdentity(this.identity); this.signer.seed.fill(0);
    return { ...this.pending };
  }

  async send(messageHash: string): Promise<null> {
    if (this.sent || !this.pending || !this.envelope || this.pending.messageHash !== messageHash) throw new RotationError('busy');
    this.sent = true; // A timeout/rejection is ambiguous: never create another key or auto-resend.
    try {
      if (Date.now() / 1000 > this.pending.validUntil - 10) throw new RotationError('clock');
      const { Buffer } = await import('buffer');
      await this.rpc.call('sendBoc', { boc: Buffer.from(this.envelope).toString('base64') });
      return null;
    } finally { this.envelope.fill(0); this.envelope = undefined; }
  }
}
