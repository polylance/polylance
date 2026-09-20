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
    console.warn("AuditX verifyWebhook: Redis initialization failed, falling back to DB/memory:", err);
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
 */
export async function verifyAndRecordNonce(nonce: string, prisma?: PrismaClient): Promise<boolean> {
  if (!nonce || typeof nonce !== "string" || nonce.trim().length === 0) {
    return false;
  }

  const now = Date.now();
  const ttlSeconds = 600; // 10 minutes

  // 1. Try Redis with atomic SET NX EX
  if (redisClient) {
    try {
      const res = await redisClient.set(`auditx:nonce:${nonce}`, "1", {
        ex: ttlSeconds,
        nx: true,
      });
      return Boolean(res === "OK" || (res as unknown) === true || res !== null);
    } catch (err) {
      console.warn("Redis nonce check error, falling back:", err);
    }
  }

  // 2. Memory check
  const existingExpiry = memoryNonceCache.get(nonce);
  if (existingExpiry && existingExpiry > now) {
    return false; // Replayed nonce
  }

  // Clean memory cache occasionally
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
        return false;
      }

      await prisma.webhookNonce.upsert({
        where: { nonce },
        update: { usedAt: new Date(), expiresAt: new Date(now + ttlSeconds * 1000) },
        create: { nonce, usedAt: new Date(), expiresAt: new Date(now + ttlSeconds * 1000) },
      });
    } catch (err: any) {
      // If unique constraint violation, nonce was used concurrently
      if (err?.code === "P2002") {
        return false;
      }
    }
  }

  return true;
}

/**
 * Verify AuditX HMAC-SHA256 signature over timestamp.nonce.body.
 * Uses crypto.timingSafeEqual for timing-attack resistance.
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

  if (!signatureHeader) {
    return { valid: false, code: 401, error: "Missing x-auditx-signature header" };
  }

  if (!timestampHeader) {
    return { valid: false, code: 400, error: "Missing x-auditx-timestamp header" };
  }

  if (!nonceHeader) {
    return { valid: false, code: 400, error: "Missing x-auditx-nonce header" };
  }

  // 1. Validate Timestamp freshness (within 5 minutes)
  if (!validateTimestampFreshness(timestampHeader)) {
    return { valid: false, code: 401, error: "Timestamp expired or out of bounds (max 5 minutes window)" };
  }

  // 2. Validate Nonce uniqueness (reject replay)
  const nonceOk = await verifyAndRecordNonce(nonceHeader, prisma);
  if (!nonceOk) {
    return { valid: false, code: 401, error: "Invalid or replayed nonce" };
  }

  // 3. Compute expected signature over `timestamp.nonce.body`
  const messageToSign = `${timestampHeader}.${nonceHeader}.${rawBody}`;
  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(messageToSign)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedHmac, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== receivedBuf.length) {
    return { valid: false, code: 401, error: "Invalid signature length or format" };
  }

  if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    return { valid: false, code: 401, error: "Invalid signature digest mismatch" };
  }

  return { valid: true };
}

export function clearNonceMemoryCache() {
  memoryNonceCache.clear();
}
