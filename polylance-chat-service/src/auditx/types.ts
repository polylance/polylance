export interface AuditXAlertPayload {
  schema_version?: string;
  alert_id: string;
  contract_address: string;
  chain?: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  category: string;
  title: string;
  description: string;
  detected_at: string;
  tx_hash?: string | null;
  event_type?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  valid: boolean;
  code?: number;
  error?: string;
}
