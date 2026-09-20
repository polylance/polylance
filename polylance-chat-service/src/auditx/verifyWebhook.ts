import crypto from "crypto";
import { Redis } from "@upstash/redis";
import { PrismaClient } from "@prisma/client";
import { WebhookVerificationResult } from "./types.js";

const memoryNonceCache = new Map<string, number>();

function isUpstashConfigured(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return Boolean(url && token && url.trim() !== "" && token.trim() !== "" && !url.includes("your_"));
}

let redisClient: Redis | null = null;
if (isUpstashConfigured()) {
  try {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  } catch (err) {
    console.error("AuditX verifyWebhook: Upstash Redis client initialization failed:", err);
  }
}

/**
 * Validates timestamp freshness within 5 minutes (300 seconds).
 */
export function validateTimestampFreshness(timestamp: string | number): boolean {
  let tsMs = Number(timestamp);
  if (isNaN(tsMs)) {
    tsMs = Date.parse(String(timestamp));
  } else if (tsMs < 1e11) {
    // Convert seconds to milliseconds if timestamp is in unix epoch seconds
    tsMs = tsMs * 1000;
  }

  if (isNaN(tsMs)) {
    return false;
  }

  const delta = Math.abs(Date.now() - tsMs);
  return delta <= 5 * 60 * 1000; // 5 minutes max skew
}

/**
 * Checks and records a nonce to prevent replay attacks.
 * Rejects nonces that have already been used within a 10-minute window.
 * If Redis is configured and fails, FAIL CLOSED (reject), never accept.
 */
export async function verifyAndRecordNonce(nonce: string, prisma?: PrismaClient): Promise<{ ok: boolean; error?: string }> {
  if (!nonce || typeof nonce !== "string" || nonce.trim().length === 0) {
    return { ok: false, error: "Missing or invalid nonce format" };
  }

  const now = Date.now();
  const ttlSeconds = 600; // 10 minutes

  // 1. If Redis is configured, enforce strict atomic SET NX EX. Fail closed on error.
  if (isUpstashConfigured()) {
    if (!redisClient) {
      console.error("SECURITY: Redis configured but client is uninitialized — failing closed");
      return { ok: false, error: "Replay protection engine unavailable (fail-closed)" };
    }
    try {
      const res = await redisClient.set(`auditx:nonce:${nonce}`, "1", {
        ex: ttlSeconds,
        nx: true,
      });
      const success = Boolean(res === "OK" || (res as unknown) === true || res !== null);
      if (!success) {
        return { ok: false, error: "Nonce already used or replayed (Redis)" };
      }
      return { ok: true };
    } catch (err) {
      console.error("SECURITY: Redis nonce check encountered an error — failing closed:", err);
      return { ok: false, error: "Replay protection check failed (fail-closed)" };
    }
  }

  // 2. Memory cache check
  const existingExpiry = memoryNonceCache.get(nonce);
  if (existingExpiry && existingExpiry > now) {
    return { ok: false, error: "Invalid or replayed nonce (Memory)" };
  }

  // Clean memory cache if it grows large
  if (memoryNonceCache.size > 5000) {
    for (const [k, exp] of memoryNonceCache.entries()) {
      if (exp <= now) memoryNonceCache.delete(k);
    }
  }
  memoryNonceCache.set(nonce, now + ttlSeconds * 1000);

  // 3. Persist to Prisma DB if provided
  if (prisma) {
    try {
      const existing = await prisma.webhookNonce.findUnique({
        where: { nonce },
      });
      if (existing && existing.expiresAt.getTime() > now) {
        return { ok: false, error: "Invalid or replayed nonce (Database)" };
      }

      await prisma.webhookNonce.upsert({
        where: { nonce },
        update: { usedAt: new Date(), expiresAt: new Date(now + ttlSeconds * 1000) },
        create: { nonce, usedAt: new Date(), expiresAt: new Date(now + ttlSeconds * 1000) },
      });
    } catch (err: any) {
      // If unique constraint violation, nonce was used concurrently
      if (err?.code === "P2002") {
        return { ok: false, error: "Invalid or replayed nonce (Concurrent)" };
      }
    }
  }

  return { ok: true };
}

/**
 * Purge expired WebhookNonce rows from PostgreSQL.
 */
export async function purgeExpiredWebhookNonces(prisma: PrismaClient): Promise<number> {
  try {
    const deleted = await prisma.webhookNonce.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    if (deleted.count > 0) {
      console.log(`[NONCE PURGE] Removed ${deleted.count} expired webhook nonce records`);
    }
    return deleted.count;
  } catch (err) {
    console.warn("[NONCE PURGE] Failed to purge expired nonces:", err);
    return 0;
  }
}

/**
 * Verify AuditX HMAC-SHA256 signature over timestamp.nonce.body.
 * Validates hex formatting, length guard before timingSafeEqual, and fail-closed replay checks.
 */
export async function verifyAuditXWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  timestampHeader: string | null | undefined,
  nonceHeader: string | null | undefined,
  prisma?: PrismaClient
): Promise<WebhookVerificationResult> {
  const secret = process.env.AUDITX_WEBHOOK_SECRET;
  if (!secret) {
    console.error("SECURITY: AUDITX_WEBHOOK_SECRET environment variable is missing");
    return { valid: false, code: 500, error: "Server configuration error: webhook secret not set" };
  }

  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { valid: false, code: 401, error: "Missing x-auditx-signature header" };
  }

  if (!timestampHeader) {
    return { valid: false, code: 400, error: "Missing x-auditx-timestamp header" };
  }

  if (!nonceHeader) {
    return { valid: false, code: 400, error: "Missing x-auditx-nonce header" };
  }

  // 1. Strict Hex Format & Length Validation on Signature (Must be exactly 64 hex chars for SHA-256)
  const cleanSig = signatureHeader.startsWith("0x") ? signatureHeader.slice(2) : signatureHeader;
  const isHex64 = /^[0-9a-fA-F]{64}$/.test(cleanSig);
  if (!isHex64) {
    return { valid: false, code: 401, error: "Invalid signature format: expected 64 hex characters" };
  }

  // 2. Validate Timestamp freshness (within 5 minutes)
  if (!validateTimestampFreshness(timestampHeader)) {
    return { valid: false, code: 401, error: "Timestamp expired or out of bounds (max 5 minutes window)" };
  }

  // 3. Validate Nonce uniqueness (reject replay, fail closed)
  const nonceResult = await verifyAndRecordNonce(nonceHeader, prisma);
  if (!nonceResult.ok) {
    return { valid: false, code: 401, error: nonceResult.error || "Invalid or replayed nonce" };
  }

  // 4. Compute expected HMAC-SHA256 signature over `timestamp.nonce.body`
  const messageToSign = `${timestampHeader}.${nonceHeader}.${rawBody}`;
  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(messageToSign)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedHmac, "hex");
  const receivedBuf = Buffer.from(cleanSig, "hex");

  // Length guard before timingSafeEqual (both must be exactly 32 bytes)
  if (expectedBuf.length !== 32 || receivedBuf.length !== 32 || expectedBuf.length !== receivedBuf.length) {
    return { valid: false, code: 401, error: "Invalid signature buffer length" };
  }

  if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    return { valid: false, code: 401, error: "Invalid signature digest mismatch" };
  }

  return { valid: true };
}

export function clearNonceMemoryCache() {
  memoryNonceCache.clear();
}
