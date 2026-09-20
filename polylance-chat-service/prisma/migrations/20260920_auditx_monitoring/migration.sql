-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditAlert" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "contract_address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "tx_hash" TEXT,
    "event_type" TEXT,
    "schema_version" TEXT NOT NULL DEFAULT '1.0.0',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',

    CONSTRAINT "AuditAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WebhookNonce" (
    "nonce" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AuditAlert_alert_id_key" ON "AuditAlert"("alert_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditAlert_contract_address_idx" ON "AuditAlert"("contract_address");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditAlert_severity_idx" ON "AuditAlert"("severity");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditAlert_detected_at_idx" ON "AuditAlert"("detected_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookNonce_expiresAt_idx" ON "WebhookNonce"("expiresAt");
