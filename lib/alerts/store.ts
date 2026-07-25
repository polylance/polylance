// lib/alerts/store.ts

export interface AuditXAlertPayload {
  alertId?: string;
  contractAddress: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: string;
  description: string;
  detectedAt: string;
  details?: Record<string, unknown>;
}

// In-memory store for alert deduplication (can be backed by DB/Redis in prod)
const processedAlertIds = new Set<string>();

export async function storeAlert(payload: AuditXAlertPayload): Promise<string | null> {
  const alertId =
    payload.alertId ||
    `${payload.contractAddress}_${payload.category}_${payload.detectedAt}`;

  if (processedAlertIds.has(alertId)) {
    return null; // Duplicate alert detected
  }

  processedAlertIds.add(alertId);
  return alertId;
}

export function clearAlertStore() {
  processedAlertIds.clear();
}
