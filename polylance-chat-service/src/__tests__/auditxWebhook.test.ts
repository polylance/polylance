import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { createAuditXWebhookHandler } from "../auditx/webhookHandler.js";
import { clearNonceMemoryCache } from "../auditx/verifyWebhook.js";

const TEST_SECRET = "sec_test_secret_0123456789abcdef0123456789abcdef";

function generateHmac(timestamp: string, nonce: string, rawBody: string, secret = TEST_SECRET): string {
  const message = `${timestamp}.${nonce}.${rawBody}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

describe("AuditX Webhook Receiver in polylance-chat-service", () => {
  let originalSecret: string | undefined;
  let mockAlerts: Map<string, any>;
  let mockNonces: Map<string, any>;
  let mockPrisma: any;

  beforeEach(() => {
    originalSecret = process.env.AUDITX_WEBHOOK_SECRET;
    process.env.AUDITX_WEBHOOK_SECRET = TEST_SECRET;
    clearNonceMemoryCache();

    mockAlerts = new Map();
    mockNonces = new Map();

    mockPrisma = {
      auditAlert: {
        findUnique: vi.fn(async ({ where }: { where: { alert_id: string } }) => {
          return mockAlerts.get(where.alert_id) || null;
        }),
        create: vi.fn(async ({ data }: { data: any }) => {
          if (mockAlerts.has(data.alert_id)) {
            const err: any = new Error("Unique constraint violation");
            err.code = "P2002";
            throw err;
          }
          const record = {
            id: `uuid-${Date.now()}`,
            ...data,
            received_at: new Date(),
          };
          mockAlerts.set(data.alert_id, record);
          return record;
        }),
        findMany: vi.fn(async () => Array.from(mockAlerts.values())),
      },
      webhookNonce: {
        findUnique: vi.fn(async ({ where }: { where: { nonce: string } }) => {
          return mockNonces.get(where.nonce) || null;
        }),
        upsert: vi.fn(async ({ create }: { create: any }) => {
          mockNonces.set(create.nonce, create);
          return create;
        }),
      },
    };
  });

  afterEach(() => {
    process.env.AUDITX_WEBHOOK_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  const samplePayload = {
    schema_version: "1.0.0",
    alert_id: "ax_alert_polygon_001_reentrancy",
    contract_address: "0x88dd19df1b6dBA8D2c53b3976f4ec39B75f17FbB",
    chain: "137",
    severity: "CRITICAL",
    category: "REENTRANCY",
    title: "Critical Reentrancy Vector Detected",
    description: "Anomalous call pattern matching known drain sequence on claimAutoRelease",
    detected_at: new Date().toISOString(),
    tx_hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    event_type: "ALERT_TRIGGERED",
    status: "DETECTED",
  };

  function createMockReqRes(headers: Record<string, string>, body: any, rawBodyStr?: string) {
    const rawBody = rawBodyStr !== undefined ? rawBodyStr : JSON.stringify(body);
    const req: any = {
      headers: { ...headers },
      body,
      rawBody,
      socket: { remoteAddress: "127.0.0.1" },
    };

    const res: any = {
      statusCode: 200,
      jsonData: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonData = data;
        return this;
      },
    };

    return { req, res };
  }

  it("1. Successfully verifies HMAC signature over timestamp.nonce.body and commits row to Postgres", async () => {
    const timestamp = Date.now().toString();
    const nonce = `nonce_${crypto.randomBytes(8).toString("hex")}`;
    const rawBody = JSON.stringify(samplePayload);
    const signature = generateHmac(timestamp, nonce, rawBody);

    const handler = createAuditXWebhookHandler(mockPrisma);
    const { req, res } = createMockReqRes(
      {
        "x-auditx-signature": signature,
        "x-auditx-timestamp": timestamp,
        "x-auditx-nonce": nonce,
      },
      samplePayload,
      rawBody
    );

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.status).toBe("received");
    expect(res.jsonData.alert_id).toBe(samplePayload.alert_id);
    expect(mockPrisma.auditAlert.create).toHaveBeenCalledTimes(1);

    // Verify DB committed values
    const stored = mockAlerts.get(samplePayload.alert_id);
    expect(stored).toBeDefined();
    expect(stored.contract_address).toBe(samplePayload.contract_address);
    expect(stored.severity).toBe("CRITICAL");
    expect(stored.category).toBe("REENTRANCY");
  });

  it("2. Rejects webhook when timestamp is older than 5 minutes", async () => {
    const sixMinutesAgo = (Date.now() - 6 * 60 * 1000).toString();
    const nonce = `nonce_${crypto.randomBytes(8).toString("hex")}`;
    const rawBody = JSON.stringify(samplePayload);
    const signature = generateHmac(sixMinutesAgo, nonce, rawBody);

    const handler = createAuditXWebhookHandler(mockPrisma);
    const { req, res } = createMockReqRes(
      {
        "x-auditx-signature": signature,
        "x-auditx-timestamp": sixMinutesAgo,
        "x-auditx-nonce": nonce,
      },
      samplePayload,
      rawBody
    );

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData.error).toContain("Timestamp expired or out of bounds");
    expect(mockPrisma.auditAlert.create).not.toHaveBeenCalled();
  });

  it("3. Rejects webhook when timestamp is skewed into future by > 5 minutes", async () => {
    const futureTime = (Date.now() + 6 * 60 * 1000).toString();
    const nonce = `nonce_${crypto.randomBytes(8).toString("hex")}`;
    const rawBody = JSON.stringify(samplePayload);
    const signature = generateHmac(futureTime, nonce, rawBody);

    const handler = createAuditXWebhookHandler(mockPrisma);
    const { req, res } = createMockReqRes(
      {
        "x-auditx-signature": signature,
        "x-auditx-timestamp": futureTime,
        "x-auditx-nonce": nonce,
      },
      samplePayload,
      rawBody
    );

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData.error).toContain("Timestamp expired or out of bounds");
  });

  it("4. Rejects replayed nonce with HTTP 401", async () => {
    const timestamp = Date.now().toString();
    const nonce = "replayed_nonce_123456";
    const rawBody = JSON.stringify(samplePayload);
    const signature = generateHmac(timestamp, nonce, rawBody);

    const handler = createAuditXWebhookHandler(mockPrisma);

    // Request 1: First attempt succeeds
    const reqRes1 = createMockReqRes(
      {
        "x-auditx-signature": signature,
        "x-auditx-timestamp": timestamp,
        "x-auditx-nonce": nonce,
      },
      samplePayload,
      rawBody
    );
    await handler(reqRes1.req, reqRes1.res);
    expect(reqRes1.res.statusCode).toBe(201);

    // Request 2: Second attempt with identical nonce gets rejected
    const reqRes2 = createMockReqRes(
      {
        "x-auditx-signature": signature,
        "x-auditx-timestamp": timestamp,
        "x-auditx-nonce": nonce,
      },
      samplePayload,
      rawBody
    );
    await handler(reqRes2.req, reqRes2.res);
    expect(reqRes2.res.statusCode).toBe(401);
    expect(reqRes2.res.jsonData.error).toContain("Invalid or replayed nonce");
  });

  it("5. Rejects invalid HMAC signature or tampered body", async () => {
    const timestamp = Date.now().toString();
    const nonce = `nonce_${crypto.randomBytes(8).toString("hex")}`;
    const rawBody = JSON.stringify(samplePayload);
    const tamperedBody = JSON.stringify({ ...samplePayload, severity: "INFO" });
    const signature = generateHmac(timestamp, nonce, rawBody); // Signed against rawBody, but sending tamperedBody

    const handler = createAuditXWebhookHandler(mockPrisma);
    const { req, res } = createMockReqRes(
      {
        "x-auditx-signature": signature,
        "x-auditx-timestamp": timestamp,
        "x-auditx-nonce": nonce,
      },
      JSON.parse(tamperedBody),
      tamperedBody
    );

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData.error).toContain("signature");
    expect(mockPrisma.auditAlert.create).not.toHaveBeenCalled();
  });

  it("6. Rejects missing required headers with 400/401", async () => {
    const handler = createAuditXWebhookHandler(mockPrisma);

    // Missing signature
    const { req: r1, res: res1 } = createMockReqRes(
      { "x-auditx-timestamp": Date.now().toString(), "x-auditx-nonce": "n1" },
      samplePayload
    );
    await handler(r1, res1);
    expect(res1.statusCode).toBe(401);

    // Missing timestamp
    const { req: r2, res: res2 } = createMockReqRes(
      { "x-auditx-signature": "sig", "x-auditx-nonce": "n2" },
      samplePayload
    );
    await handler(r2, res2);
    expect(res2.statusCode).toBe(400);

    // Missing nonce
    const { req: r3, res: res3 } = createMockReqRes(
      { "x-auditx-signature": "sig", "x-auditx-timestamp": Date.now().toString() },
      samplePayload
    );
    await handler(r3, res3);
    expect(res3.statusCode).toBe(400);
  });

  it("7. Handles duplicate alert_id idempotently without throwing (HTTP 200)", async () => {
    const timestamp1 = Date.now().toString();
    const nonce1 = `nonce_1_${Date.now()}`;
    const rawBody1 = JSON.stringify(samplePayload);
    const signature1 = generateHmac(timestamp1, nonce1, rawBody1);

    const handler = createAuditXWebhookHandler(mockPrisma);

    // 1st delivery
    const { req: req1, res: res1 } = createMockReqRes(
      { "x-auditx-signature": signature1, "x-auditx-timestamp": timestamp1, "x-auditx-nonce": nonce1 },
      samplePayload,
      rawBody1
    );
    await handler(req1, res1);
    expect(res1.statusCode).toBe(201);

    // 2nd delivery (new nonce & timestamp, but same alert_id)
    const timestamp2 = (Date.now() + 1000).toString();
    const nonce2 = `nonce_2_${Date.now()}`;
    const signature2 = generateHmac(timestamp2, nonce2, rawBody1);

    const { req: req2, res: res2 } = createMockReqRes(
      { "x-auditx-signature": signature2, "x-auditx-timestamp": timestamp2, "x-auditx-nonce": nonce2 },
      samplePayload,
      rawBody1
    );
    await handler(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.jsonData.status).toBe("duplicate, already recorded");
    expect(res2.jsonData.alert_id).toBe(samplePayload.alert_id);
  });

  it("8. Validates full versioned AuditX contract schema end-to-end", async () => {
    const contractPayload = {
      schema_version: "1.0.0",
      alert_id: "ax_audit_137_0x88dd_scam_counterparty",
      contract_address: "0x88dd19df1b6dBA8D2c53b3976f4ec39B75f17FbB",
      chain: "polygon-mainnet",
      severity: "HIGH",
      category: "SCAM_FLAGGED_COUNTERPARTY",
      title: "Applicant flagged on OFAC / Scam watchlist",
      description: "Applicant address 0x9999... matches sanctioned entity database",
      detected_at: "2026-09-20T23:00:00.000Z",
      tx_hash: "0x9999888877776666555544443333222211110000aaaaabbbbbcccccdddddeeeee",
      event_type: "COUNTERPARTY_FLAGGED",
      status: "OPEN",
      metadata: {
        confidence_score: 0.98,
        source: "Chainalysis Watchlist API",
      },
    };

    const timestamp = Date.now().toString();
    const nonce = `nonce_schema_${Date.now()}`;
    const rawBody = JSON.stringify(contractPayload);
    const signature = generateHmac(timestamp, nonce, rawBody);

    const handler = createAuditXWebhookHandler(mockPrisma);
    const { req, res } = createMockReqRes(
      {
        "x-auditx-signature": signature,
        "x-auditx-timestamp": timestamp,
        "x-auditx-nonce": nonce,
      },
      contractPayload,
      rawBody
    );

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.status).toBe("received");
    expect(res.jsonData.alert_id).toBe(contractPayload.alert_id);

    const committed = mockAlerts.get(contractPayload.alert_id);
    expect(committed.schema_version).toBe("1.0.0");
    expect(committed.category).toBe("SCAM_FLAGGED_COUNTERPARTY");
    expect(committed.severity).toBe("HIGH");
  });
});
