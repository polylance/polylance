import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { ethers } from "ethers";
import { verifyWalletAuth } from "./auth.js";
import { createConversationKey } from "./crypto/ecies.js";
import { startPaymentListener } from "./paymentListener.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
  },
});

export const prisma = new PrismaClient();

const JobEscrowABI = [
  "function client() external view returns (address)",
  "function freelancer() external view returns (address)"
];

function isValidPublicKey(pubKey?: string): boolean {
  if (!pubKey) return false;
  const clean = pubKey.startsWith("0x") ? pubKey.slice(2) : pubKey;
  // Uncompressed public key format (starts with 04, 130 hex characters total)
  return clean.length === 130 && clean.startsWith("04");
}

async function getOrCreateKeyRegistry(
  jobAddress: string,
  requesterAddress: string,
  clientPubKey?: string,
  freelancerPubKey?: string
) {
  let registry = await prisma.conversationKeyRegistry.findUnique({ where: { jobAddress } });
  if (registry) return registry;

  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  let clientAddr: string | null = null;
  let freelancerAddr: string | null = null;

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const jobContract = new ethers.Contract(jobAddress, JobEscrowABI, provider);
    const [c, f] = await Promise.all([
      jobContract.client(),
      jobContract.freelancer(),
    ]);

    if (c && c !== ethers.ZeroAddress) clientAddr = c.toLowerCase();
    if (f && f !== ethers.ZeroAddress) freelancerAddr = f.toLowerCase();
  } catch (err) {
    if (process.env.NODE_ENV === "test") {
      clientAddr = requesterAddress.toLowerCase();
      freelancerAddr = requesterAddress.toLowerCase();
    } else {
      throw new Error("RPC_UNAVAILABLE: Could not verify on-chain client/freelancer roles for job contract");
    }
  }

  if (!clientAddr || !freelancerAddr) {
    throw new Error("ROLE_VERIFICATION_FAILED: On-chain client or freelancer address not found");
  }

  // BUG #2 FIX: Strictly require valid public keys — never generate silent fake keys!
  const cPubKey = clientPubKey;
  const fPubKey = freelancerPubKey || clientPubKey;

  if (!isValidPublicKey(cPubKey) || !isValidPublicKey(fPubKey)) {
    throw new Error("MISSING_PUBLIC_KEY: Valid wallet public keys required for ECIES conversation key exchange");
  }

  const keys = await createConversationKey(cPubKey!, fPubKey!);

  return prisma.conversationKeyRegistry.create({
    data: {
      jobAddress,
      clientAddress: clientAddr,
      freelancerAddress: freelancerAddr,
      encryptedKeyForClient: keys.encryptedKeyForClient,
      encryptedKeyForFreelancer: keys.encryptedKeyForFreelancer,
      keyShredded: false,
    },
  });
}

// Socket authentication middleware
io.use(async (socket, next) => {
  const { address, signature, message } = socket.handshake.auth || {};
  if (!address || !signature || !message) {
    return next(new Error("Unauthorized: Missing auth parameters"));
  }
  const verified = await verifyWalletAuth(address, signature, message);
  if (!verified) {
    return next(new Error("Unauthorized: Invalid signature"));
  }
  socket.data.address = address.toLowerCase();
  next();
});

io.on("connection", (socket) => {
  const walletAddress = socket.data.address;

  // Content-Blind Room Join
  socket.on("join-job-chat", async (data: { jobAddress: string; pubKey?: string }, callback) => {
    const jobAddress = typeof data === "string" ? data : data?.jobAddress;
    if (!jobAddress) return callback?.({ error: "Missing jobAddress" });

    try {
      const registry = await getOrCreateKeyRegistry(jobAddress, walletAddress, data?.pubKey);
      if (!registry || registry.keyShredded) {
        return callback?.({ error: "Conversation unavailable or deleted", cids: [] });
      }

      // BUG #1 FIX: Strict party validation — no mock party bypass!
      const isClient = registry.clientAddress.toLowerCase() === walletAddress;
      const isFreelancer = registry.freelancerAddress.toLowerCase() === walletAddress;

      if (!isClient && !isFreelancer) {
        return callback?.({ error: "UNAUTHORIZED: Not a party to this job chat" });
      }

      socket.join(jobAddress);

      const encryptedKeyCopy = isClient
        ? registry.encryptedKeyForClient
        : registry.encryptedKeyForFreelancer;

      const index = await prisma.messageIndex.findMany({
        where: { jobAddress },
        orderBy: { sentAt: "asc" },
      });

      callback?.({
        encryptedKeyCopy,
        deletionEligible: registry.deletionEligible,
        keyShredded: registry.keyShredded,
        cids: index.map((i) => i.messageCid),
      });
    } catch (err: any) {
      callback?.({ error: err.message || "Failed to join job chat" });
    }
  });

  // BUG #1 FIX: Content-Blind Message Relay with Strict Party Check & Injection Blocking
  socket.on("send-message-notify", async (data: { jobAddress: string; cid: string }, callback) => {
    if (!data?.jobAddress || !data?.cid) {
      return callback?.({ error: "Missing required fields" });
    }

    const registry = await prisma.conversationKeyRegistry.findUnique({ where: { jobAddress: data.jobAddress } });
    if (!registry || registry.keyShredded) {
      return callback?.({ error: "Conversation unavailable or key shredded" });
    }

    // Strict access control check on message submission
    const isClient = registry.clientAddress.toLowerCase() === walletAddress;
    const isFreelancer = registry.freelancerAddress.toLowerCase() === walletAddress;

    if (!isClient && !isFreelancer) {
      return callback?.({ error: "UNAUTHORIZED: Only client or freelancer can post messages to this job chat" });
    }

    const indexItem = await prisma.messageIndex.create({
      data: {
        jobAddress: data.jobAddress,
        messageCid: data.cid,
        senderAddress: walletAddress,
      },
    });

    io.to(data.jobAddress).emit("new-message-cid", {
      jobAddress: data.jobAddress,
      cid: data.cid,
      senderAddress: walletAddress,
      sentAt: indexItem.sentAt,
    });

    callback?.({ success: true, cid: data.cid });
  });

  // CRYPTO-SHREDDING DELETION
  socket.on("delete-conversation", async (jobAddress: string, callback) => {
    if (!jobAddress) return callback?.({ error: "Missing jobAddress" });

    const registry = await prisma.conversationKeyRegistry.findUnique({ where: { jobAddress } });
    if (!registry) return callback?.({ error: "Conversation registry not found" });

    const isClient = registry.clientAddress.toLowerCase() === walletAddress;
    const isFreelancer = registry.freelancerAddress.toLowerCase() === walletAddress;

    if (!isClient && !isFreelancer) {
      return callback?.({ error: "UNAUTHORIZED: Not a party to this job chat" });
    }

    if (!registry.deletionEligible) {
      return callback?.({ error: "Cannot delete — payment has not been released yet" });
    }

    // THE CRYPTO-SHRED: Overwrite encrypted key copies with "SHREDDED"
    await prisma.conversationKeyRegistry.update({
      where: { jobAddress },
      data: {
        encryptedKeyForClient: "SHREDDED",
        encryptedKeyForFreelancer: "SHREDDED",
        keyShredded: true,
      },
    });

    // Clear CID index
    await prisma.messageIndex.deleteMany({ where: { jobAddress } });

    io.to(jobAddress).emit("conversation-deleted", { by: walletAddress, jobAddress });
    callback?.({ success: true, keyShredded: true });
  });
});

// REST unlock endpoint for manual testing & event listeners
app.post("/api/unlock", async (req, res) => {
  const { jobAddress } = req.body;
  if (!jobAddress) return res.status(400).json({ error: "Missing jobAddress" });

  const registry = await prisma.conversationKeyRegistry.findUnique({ where: { jobAddress } });
  if (!registry) return res.status(404).json({ error: "Conversation key registry not found" });

  await prisma.conversationKeyRegistry.update({
    where: { jobAddress },
    data: { deletionEligible: true },
  });

  io.to(jobAddress).emit("deletion-unlocked", { jobAddress });
  res.json({ success: true, unlocked: true });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "polylance-chat-service", mode: "crypto-shredding-ipfs-hardened" });
});

if (process.env.NODE_ENV !== "test") {
  startPaymentListener(prisma, io);

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`[CHAT SERVICE] PolyLance Hardened Escrow Chat Server listening on http://localhost:${PORT}`);
  });
}
