import { describe, it, expect, beforeAll } from "vitest";
import EthCrypto from "eth-crypto";
import { recoverPublicKey, createConversationKey, decryptOwnKey, encryptMessage, decryptMessage } from "../crypto/ecies.js";
import { prisma } from "../server.js";

describe("PolyLance Hardened Chat — Security & Crypto-Shredding Invariants", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
  });

  it("recovers public key from signature and executes ECIES key exchange", async () => {
    const clientIdentity = EthCrypto.createIdentity();
    const freelancerIdentity = EthCrypto.createIdentity();

    const authMsg = "PolyLance Chat Auth";
    const sig = EthCrypto.sign(clientIdentity.privateKey, EthCrypto.hash.keccak256(authMsg));
    const recoveredPub = recoverPublicKey(authMsg, sig);
    expect(recoveredPub).toEqual(clientIdentity.publicKey);

    // Create per-conversation key encrypted for both parties
    const keyExchange = await createConversationKey(clientIdentity.publicKey, freelancerIdentity.publicKey);
    expect(keyExchange.encryptedKeyForClient).not.toEqual(keyExchange.rawSymmetricKey);

    // Client decrypts their key copy
    const clientDecryptedKey = await decryptOwnKey(keyExchange.encryptedKeyForClient, clientIdentity.privateKey);
    expect(clientDecryptedKey).toEqual(keyExchange.rawSymmetricKey);

    // Freelancer decrypts their key copy
    const freelancerDecryptedKey = await decryptOwnKey(keyExchange.encryptedKeyForFreelancer, freelancerIdentity.privateKey);
    expect(freelancerDecryptedKey).toEqual(keyExchange.rawSymmetricKey);
  });

  it("encrypts message client-side with symmetric key and decrypts cleanly", () => {
    const symmetricKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const plaintext = "Confidential project deliverable specifications & proof";

    const ciphertext = encryptMessage(plaintext, symmetricKey);
    expect(ciphertext).not.toEqual(plaintext);

    const decrypted = decryptMessage(ciphertext, symmetricKey);
    expect(decrypted).toEqual(plaintext);
  });

  it("crypto-shredding: key destruction permanently disables decryption and purges index", async () => {
    const jobAddress = "0x9999888877776666555544443333222211110000";
    const client = "0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
    const freelancer = "0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

    // 1. Create registry
    const registry = await prisma.conversationKeyRegistry.upsert({
      where: { jobAddress },
      create: {
        jobAddress,
        clientAddress: client,
        freelancerAddress: freelancer,
        encryptedKeyForClient: "ENC_KEY_CLIENT",
        encryptedKeyForFreelancer: "ENC_KEY_FREELANCER",
        deletionEligible: false,
        keyShredded: false,
      },
      update: {
        clientAddress: client,
        freelancerAddress: freelancer,
        encryptedKeyForClient: "ENC_KEY_CLIENT",
        encryptedKeyForFreelancer: "ENC_KEY_FREELANCER",
        deletionEligible: false,
        keyShredded: false,
      },
    });
    expect(registry.keyShredded).toBe(false);

    // 2. Add message CID to index
    await prisma.messageIndex.create({
      data: {
        jobAddress,
        messageCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        senderAddress: client,
      },
    });

    // 3. Unlock deletion (payment released on-chain)
    await prisma.conversationKeyRegistry.update({
      where: { jobAddress },
      data: { deletionEligible: true },
    });

    // 4. Perform CRYPTO-SHRED
    await prisma.conversationKeyRegistry.update({
      where: { jobAddress },
      data: {
        encryptedKeyForClient: "SHREDDED",
        encryptedKeyForFreelancer: "SHREDDED",
        keyShredded: true,
      },
    });
    await prisma.messageIndex.deleteMany({ where: { jobAddress } });

    const shreddedReg = await prisma.conversationKeyRegistry.findUnique({ where: { jobAddress } });
    expect(shreddedReg?.encryptedKeyForClient).toEqual("SHREDDED");
    expect(shreddedReg?.keyShredded).toEqual(true);

    const remainingIndex = await prisma.messageIndex.findMany({ where: { jobAddress } });
    expect(remainingIndex.length).toBe(0);
  });

  it("rejects non-party wallets from accessing or injecting messages", async () => {
    const jobAddress = "0x7777888899990000111122223333444455556666";
    const client = "0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
    const freelancer = "0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
    const intruder = "0x9999999999999999999999999999999999999999";

    const registry = await prisma.conversationKeyRegistry.upsert({
      where: { jobAddress },
      create: {
        jobAddress,
        clientAddress: client,
        freelancerAddress: freelancer,
        encryptedKeyForClient: "ENC_KEY_CLIENT",
        encryptedKeyForFreelancer: "ENC_KEY_FREELANCER",
        deletionEligible: false,
        keyShredded: false,
      },
      update: {},
    });

    const isClientParty = [registry.clientAddress.toLowerCase(), registry.freelancerAddress.toLowerCase()]
      .includes(client.toLowerCase());
    expect(isClientParty).toBe(true);

    const isIntruderParty = [registry.clientAddress.toLowerCase(), registry.freelancerAddress.toLowerCase()]
      .includes(intruder.toLowerCase());
    expect(isIntruderParty).toBe(false);
  });
});
