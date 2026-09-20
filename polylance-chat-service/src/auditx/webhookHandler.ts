import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyAuditXWebhook } from "./verifyWebhook.js";
import { AuditXAlertPayload } from "./types.js";
import { notifyAdmins } from "../notifications.js";
import { webhookLimiter, failedWebhookAuthLimiter } from "../ratelimit.js";

export function createAuditXWebhookHandler(prisma: PrismaClient) {
  return async function auditxWebhookHandler(req: Request, res: Response): Promise<void> {
    const ip = req.headers["x-forwarded-for"]?.toString() || req.socket.remoteAddress || "unknown";

    // 1. Rate Limit: Overall webhook traffic ceiling (100 req / 1 min per IP)
    const volumeCheck = await webhookLimiter.limit(ip);
    if (!volumeCheck.success) {
      console.warn(JSON.stringify({ event: "rate_limited", route: "/api/webhooks/auditx-alert", identifier: ip, type: "webhook_volume" }));
      res.status(429).json({ error: "Rate limit exceeded — too many webhook requests", code: "RATE_LIMITED" });
      return;
    }

    const rawBody = (req as any).rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    const signature = (req.headers["x-auditx-signature"] || req.headers["x-signature"])?.toString();
    const timestamp = (req.headers["x-auditx-timestamp"] || req.headers["x-timestamp"])?.toString();
    const nonce = (req.headers["x-auditx-nonce"] || req.headers["x-nonce"])?.toString();

    // 2. Cryptographic and Replay Verification
    const verification = await verifyAuditXWebhook(rawBody, signature, timestamp, nonce, prisma);
    if (!verification.valid) {
      const authLimitCheck = await failedWebhookAuthLimiter.limit(ip);
      if (!authLimitCheck.success) {
        console.error(`SECURITY: Repeated failed webhook auth from ${ip} — brute force throttled`);
        console.log(JSON.stringify({ event: "security_brute_force_throttled", route: "/api/webhooks/auditx-alert", identifier: ip }));
      } else {
        console.warn(`Rejected AuditX webhook from ${ip}: ${verification.error}`);
      }
      res.status(verification.code || 401).json({ error: verification.error || "Invalid signature" });
      return;
    }

    // 3. Payload Parsing and Field Validation
    let rawPayload: any;
    try {
      rawPayload = typeof req.body === "object" ? req.body : JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "Invalid JSON body format" });
      return;
    }

    const payload: AuditXAlertPayload = {
      schema_version: rawPayload.schema_version || rawPayload.schemaVersion || "1.0.0",
      alert_id: rawPayload.alert_id || rawPayload.alertId || rawPayload.id,
      contract_address: rawPayload.contract_address || rawPayload.contractAddress,
      chain: rawPayload.chain || "137",
      severity: (rawPayload.severity || "INFO").toUpperCase(),
      category: rawPayload.category || "GENERAL",
      title: rawPayload.title || rawPayload.description?.slice(0, 50) || "AuditX Security Alert",
      description: rawPayload.description,
      detected_at: rawPayload.detected_at || rawPayload.detectedAt,
      tx_hash: rawPayload.tx_hash || rawPayload.txHash || null,
      event_type: rawPayload.event_type || rawPayload.eventType || null,
      status: rawPayload.status || "RECEIVED",
      metadata: rawPayload.metadata,
    };

    if (!payload.alert_id || !payload.contract_address || !payload.severity || !payload.description || !payload.detected_at) {
      res.status(400).json({
        error: "Missing required fields: alert_id, contract_address, severity, description, and detected_at are required",
      });
      return;
    }

    const detectedDate = new Date(payload.detected_at);
    if (isNaN(detectedDate.getTime())) {
      res.status(400).json({ error: "Invalid detected_at timestamp format" });
      return;
    }

    // 4. Check for Idempotent Duplicates
    try {
      const existing = await prisma.auditAlert.findUnique({
        where: { alert_id: payload.alert_id },
      });

      if (existing) {
        res.status(200).json({
          status: "duplicate, already recorded",
          alert_id: existing.alert_id,
          received_at: existing.received_at,
        });
        return;
      }
    } catch (err) {
      console.warn("AuditAlert duplicate pre-check failed, continuing to insert:", err);
    }

    // 5. Durable Database Commit
    let committedAlert: any;
    try {
      committedAlert = await prisma.auditAlert.create({
        data: {
          alert_id: payload.alert_id,
          contract_address: payload.contract_address,
          chain: payload.chain || "137",
          severity: payload.severity,
          category: payload.category,
          title: payload.title,
          description: payload.description,
          detected_at: detectedDate,
          tx_hash: payload.tx_hash,
          event_type: payload.event_type,
          schema_version: payload.schema_version || "1.0.0",
          status: payload.status || "RECEIVED",
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        // Handled race condition: alert_id unique constraint hit
        res.status(200).json({
          status: "duplicate, already recorded",
          alert_id: payload.alert_id,
        });
        return;
      }
      console.error("Failed to commit AuditAlert to Postgres:", err);
      res.status(500).json({ error: "Failed to persist alert in database" });
      return;
    }

    // 6. Post-Commit Admin Notification for High/Critical Alerts
    if (payload.severity === "CRITICAL" || payload.severity === "HIGH") {
      notifyAdmins({
        title: `${payload.severity} Security Alert: ${payload.title}`,
        body: payload.description,
        contractAddress: payload.contract_address,
        severity: payload.severity,
        alertId: payload.alert_id,
      }).catch((err) => {
        console.error("Admin notification failed post-commit:", err);
      });
    }

    // 7. Respond 2xx only after row is committed
    res.status(201).json({
      status: "received",
      alert_id: committedAlert.alert_id,
      received_at: committedAlert.received_at,
    });
  };
}
