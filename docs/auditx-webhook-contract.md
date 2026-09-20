# AuditX Webhook Integration Contract

This document specifies the cryptographic interface, authentication headers, request payload schema, and verification test vectors for AuditX security monitoring webhooks delivered to PolyLance.

---

## 1. Webhook Endpoint Specification

- **Protocol & Method**: `POST`
- **Path**: `/api/webhooks/auditx-alert`
- **Production URL**: `https://polylance-fv-1.onrender.com/api/webhooks/auditx-alert`
- **Content-Type**: `application/json`

---

## 2. Required Request Headers

Every request from AuditX must supply three security headers:

| Header Name | Type | Description |
|---|---|---|
| `x-auditx-signature` | `string` (hex) | Hex-encoded HMAC-SHA256 signature (64 characters) computed over `${timestamp}.${nonce}.${rawBody}` using the shared webhook secret. |
| `x-auditx-timestamp` | `string` (epoch ms / sec / ISO) | Request generation timestamp. PolyLance enforces a strict **5-minute (300 seconds) freshness window**. Any request older than 5 minutes or skewed into the future by > 5 minutes is rejected with `401 Unauthorized`. |
| `x-auditx-nonce` | `string` (UUID / random) | Unique cryptographic nonce per request. PolyLance maintains a 10-minute replay cache. Replayed nonces are rejected with `401 Unauthorized`. |

---

## 3. Cryptographic Signature Generation

```
MessageToSign = "${x-auditx-timestamp}.${x-auditx-nonce}.${rawBody}"
Signature = HMAC_SHA256(SecretKey, MessageToSign).toHex()
```

### Signature Properties
- **Algorithm**: `HMAC-SHA256`
- **Output Format**: Lowercase or uppercase 64-character hexadecimal string
- **Encoding**: UTF-8 bytes for message and secret
- **Comparison Guard**: Constant-time comparison (`crypto.timingSafeEqual`) with strict 32-byte length pre-check.

---

## 4. Response Status Codes

| HTTP Code | Description | Example Body |
|---|---|---|
| `201 Created` | Alert validated, deduplicated, and committed to PostgreSQL database. | `{"status": "received", "alert_id": "ax_001", "received_at": "2026-09-20T23:00:01.123Z"}` |
| `200 OK` | Duplicate alert received (idempotency key `alert_id` already exists). | `{"status": "duplicate, already recorded", "alert_id": "ax_001"}` |
| `400 Bad Request` | Missing required headers or malformed payload fields. | `{"error": "Missing required fields: alert_id, contract_address, severity..."}` |
| `401 Unauthorized` | Invalid HMAC signature, expired timestamp, or replayed nonce. | `{"error": "Invalid signature digest mismatch"}` |
| `429 Too Many Requests` | IP rate limit exceeded (100 req/min ceiling or 5 failed auth attempts/min). | `{"error": "Rate limit exceeded", "code": "RATE_LIMITED"}` |
| `500 Server Error` | Database persistence or internal engine error. | `{"error": "Failed to persist alert in database"}` |

---

## 5. Test Vectors

**Shared Test Secret**: `sec_test_auditx_shared_secret_2026_poly`

### Test Vector 1 (Critical Reentrancy Alert)
- **`x-auditx-timestamp`**: `1726850000000`
- **`x-auditx-nonce`**: `nonce_v1_001`
- **Raw Body**:
  ```json
  {"schema_version":"1.0.0","alert_id":"ax_001","contract_address":"0x88dd19df1b6dBA8D2c53b3976f4ec39B75f17FbB","chain":"137","severity":"CRITICAL","category":"REENTRANCY","title":"Reentrancy Vector Detected","description":"Anomalous reentrant call pattern detected","detected_at":"2026-09-20T23:00:00.000Z"}
  ```
- **Expected `x-auditx-signature`**:
  ```
  d66567cbe5a7e89fb49e7cc1bb04aac712f3515cd1396fa8457b70856bda9f25
  ```

### Test Vector 2 (Sanctioned Counterparty Alert with Tx Hash)
- **`x-auditx-timestamp`**: `1726850050000`
- **`x-auditx-nonce`**: `nonce_v2_002`
- **Raw Body**:
  ```json
  {"schema_version":"1.0.0","alert_id":"ax_002","contract_address":"0xbE74923BBfd72d400a681915dBcf6e6Adc72C317","chain":"polygon-mainnet","severity":"HIGH","category":"SCAM_FLAGGED_COUNTERPARTY","title":"Sanctioned Counterparty Flagged","description":"Applicant wallet flagged on watchlist","detected_at":"2026-09-20T23:05:00.000Z","tx_hash":"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"}
  ```
- **Expected `x-auditx-signature`**:
  ```
  48b51413b2811eb3a784a6c5d4ee45fea4c6ae29b2860b296fb16ca521a6745e
  ```

### Test Vector 3 (Anomalous Flow Alert with Metadata)
- **`x-auditx-timestamp`**: `1726850100000`
- **`x-auditx-nonce`**: `nonce_v3_003`
- **Raw Body**:
  ```json
  {"schema_version":"1.0.0","alert_id":"ax_003","contract_address":"0x22A61f83cEB94233d30a20EEacBdEB9BCC1C2879","chain":"137","severity":"MEDIUM","category":"ANOMALOUS_VALUE_FLOW","title":"High Velocity Mint Sequence","description":"Unusual frequency of SBT minting operations","detected_at":"2026-09-20T23:10:00.000Z","status":"OPEN","metadata":{"velocity_score":8.4}}
  ```
- **Expected `x-auditx-signature`**:
  ```
  03920e70e89079629bd7bfaf091f0f1c6ecd6720e2e46b51eb60fb6dfc27cd78
  ```
