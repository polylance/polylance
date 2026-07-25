import crypto from "crypto";
import { storeAlert } from "../../../../lib/alerts/store";
import { notifyAdmins } from "../../../../lib/notifications";

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const secret = process.env.AUDITX_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export async function POST(req: Request) {
  const rawBody = await req.text(); // read raw text BEFORE parsing — sign/verify the actual bytes received
  const signature = req.headers.get("x-auditx-signature");

  if (!verifySignature(rawBody, signature)) {
    console.warn("Rejected AuditX webhook: invalid signature", {
      ip: req.headers.get("x-forwarded-for"),
    });
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const alertId = await storeAlert(payload);
  if (alertId === null) {
    return Response.json({ status: "duplicate" }, { status: 200 });
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
