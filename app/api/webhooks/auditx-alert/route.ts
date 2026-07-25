import { verifyAuditXSignature } from "../../../../lib/auditx/verifyWebhook";
import { storeAlert, AuditXAlertPayload } from "../../../../lib/alerts/store";
import { notifyAdmins } from "../../../../lib/notifications";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-auditx-signature");

  if (!verifyAuditXSignature(rawBody, signature)) {
    // Log the attempt — repeated failures here could indicate someone
    // probing the endpoint, worth knowing about even though we reject it
    console.warn("Rejected webhook: invalid signature", {
      ip: req.headers.get("x-forwarded-for"),
    });
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: AuditXAlertPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.contractAddress || !payload.severity || !payload.description) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Idempotency: AuditX's own retry-on-failure logic (or a network
  // blip) could deliver the same alert twice — dedupe on a content hash
  const alertId = await storeAlert(payload);
  if (alertId === null) {
    return Response.json({ status: "duplicate, already recorded" }, { status: 200 });
  }

  if (payload.severity === "CRITICAL" || payload.severity === "HIGH") {
    await notifyAdmins({
      title: `${payload.severity} alert on job ${payload.contractAddress.slice(0, 8)}...`,
      body: payload.description,
      contractAddress: payload.contractAddress,
    });
  }

  return Response.json({ status: "received", alertId }, { status: 200 });
}
