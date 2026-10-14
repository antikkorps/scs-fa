# Henrri API reference (story 12.6)

`openapi-v1.json` is the Henrri API v1.0 OpenAPI 3.1 specification, downloaded
on 2026-10-14 from the sandbox reference
(`https://api-sandbox.henrri.io/scalar/v1`, source `henrriapi/v1.json`).

It is kept here as the reference for the simulated Henrri client used in CI,
and so the integration can be audited against the exact contract it was built
on. Refresh it when Henrri ships a new version (the changelog lives in
`info.description`), and review the diff before upgrading the client.

| Environment | Base URL                        |
| :---------- | :------------------------------ |
| Production  | `https://api.henrri.io`         |
| Sandbox     | `https://api-sandbox.henrri.io` |

Facts that shape the integration:

- **Auth**: `POST /v1/users/authenticate` with `clientId` + `clientSecret`,
  returns a JWT valid 600 s and a refresh token.
- **Invoice flow**: `POST /v1/documents` (empty draft), then one
  `POST /v1/documents/{id}/lines` per line, then
  `POST /v1/documents/{id}/finalize`. The number (`identity`) is assigned at
  finalization. Drafts are free and deletable; a finalized invoice or credit
  note costs 8 credits and can never be deleted (anti-fraud rules).
- **No external reference field** on documents: idempotence relies on storing
  the Henrri document id on our side as soon as the draft exists.
- **Chronology**: an accounting document dated before the last finalized one is
  rejected (`NUMBERING_DATE_SEQUENCE`). The first one of a month may be
  refused with `FIRST_ACCOUNTING_DOCUMENT_MONTH`, asking for a
  `confirmFirstOfMonth` flag that the documented finalize body does not carry:
  to check on the sandbox.
- **PDF**: `POST /v1/documents/{id}/pdf/url` returns a URL valid 10 minutes
  (bearer token required). Reads are free.
- **Webhooks** are signed with HMAC-SHA256 (`X-Henrri-Webhook-Signature`,
  `X-Henrri-Webhook-Timestamp`, `X-Henrri-Webhook-Delivery`).
