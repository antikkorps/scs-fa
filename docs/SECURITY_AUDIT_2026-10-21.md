# Security Audit — Delta Since the 8.6 Pentest

Date: 2026-10-21 · Decisions: 2026-10-22 · Scope: everything shipped since
[the 8.6 pentest](SECURITY_PENTEST_8.6.md) (stories 9.x to 12.8c: Henrri
invoicing, logging, pro accounts, login codes, quote requests, catalogue
import, Gun Art, shipping) plus infrastructure and dependencies.

Four read-only auditors swept authentication/access control, data exposure,
payments and business logic, and infrastructure/dependencies. The top findings
were then re-checked against the code. Nothing here is in production yet: every
**High** item must be fixed before the first deployment.

## Executive summary

The controls verified in 8.6 still hold: ownership scoping, `requireRole` on
admin routes, server-side price authority on order totals, signed and
idempotent webhooks, parameterized queries, error redaction.

The gaps are mostly in **business logic added since then** (orders that are
never paid, cart state that is not re-validated at checkout, VIP lifecycle),
in **prod configuration guards** (sample secrets accepted), and in
**dependency hygiene** (`pnpm audit --prod`: 5 critical, 36 high, 23 moderate,
1 low on 2026-10-22, and nothing in CI to notice it).

## Decisions (Franck, 2026-10-22)

| Topic | Decision |
| --- | --- |
| Unpaid order expiry | Card: cancelled after **1 hour**. Bank transfer: reminder e-mail at **day 4**, cancelled after **7 days**. Cancellation releases stock, Gun Art prints and unique pieces. |
| Price changed between cart and checkout | **Refuse with 409** and return the refreshed cart; the customer confirms again. Same for an item unpublished or switched to pro-only. |
| Category A | **Not sellable to private customers.** Only through a pro quote (12.8d), once SCS has approved the organisation's supporting document. |
| VIP status | Granted when the qualifying order is **paid and its legal documents are approved**. Revoked when the qualifying firearm line is refunded (partial refund included), unless another order still qualifies. |
| VIP discount rate | **Configurable by SCS** in the back office (today hard-coded as 50 % of the margin in `packages/shared/src/vip.ts`). Orders keep the rate they froze (`vipDiscountAppliedPct`). Storage: single-row `shop_settings` table (proposed, see BACKLOG). |

## Findings

### High

1. **Unpaid orders hold inventory forever.** An order reserves stock, Gun Art
   prints and unique collection pieces at creation; only a full refund
   releases them, and there is no expiry and no cancel route
   (`apps/api/src/orders/index.ts`). Anyone with an account can lock the
   whole catalogue of unique pieces. → Expiry job per the decision above,
   compare-and-set cancellation (never cancel an order a webhook just paid),
   customer e-mails, history entry.
2. **Sample secrets pass production validation.** The placeholders of
   `.env.prod.example` satisfy `apps/api/src/env.ts`: `JWT_SECRET` /
   `JWT_REFRESH_SECRET` (`CHANGE-ME…`, more than 32 characters — a forgeable
   admin JWT if copied as is), `INTERNAL_API_SECRET`, `BREVO_WEBHOOK_SECRET`,
   and `ADMIN_SEED_PASSWORD` only refuses the dev sample. → In production,
   refuse any value containing `change-me` (case-insensitive) or equal to a
   committed sample, and require high-entropy secrets.
3. **Known-vulnerable dependencies, and no alarm.** Critical/high advisories
   on fastify, @fastify/busboy, sharp, nodemailer, nuxt, fast-jwt, among
   others. Renovate's CVE bypass relies on platform alerts that Gitea does not
   provide (`osvVulnerabilityAlerts` is not enabled), and CI runs no audit. →
   Upgrade, enable `osvVulnerabilityAlerts`, add `pnpm audit --prod
   --audit-level high` to CI.

### Medium

- **Login code: attempts and resends are not atomic** (`auth/login-code.ts`):
  parallel requests can exceed the 5-attempt budget; no per-account cap across
  challenges.
- **Rate limits keyed on the full IPv6 address**: one /64 gives an attacker
  unlimited keys. → Key on the /64 prefix.
- **Global search leaks unpublished artworks** by artist name
  (`search/global.ts:96`: `a AND b OR c` without parentheses).
- **Legal document `expiresAt` is stored but never enforced.**
- **A customer can delete an approved legal document** after clearance
  (`legal-documents/index.ts`).
- **Cart not re-validated at checkout**: price, publication, pro-only audience;
  prints of unpublished artworks can be ordered. → Decision above (409).
- **VIP lifecycle** (granted at payment, kept after return). → Decision above.
- **Gun Art prints in a cart are held forever.** → Released with the cart
  expiry.
- **The API connects as the Postgres superuser.** → Dedicated role, least
  privilege.
- **Backups**: not encrypted, same credentials and bucket as the app; S3
  objects (identity documents) are not backed up.
- **BFF request body size is unbounded.**
- **Refresh-token rotation race** (two parallel refreshes).

### Low

- Password reset leaves other reset links and login challenges valid.
- Admin sessions created before migration 0028 have no cap.
- SIRET squatting at pro signup (a first claimant blocks the real company).
- A late Stripe `payment_failed` event can overwrite a success.
- Concurrent PaymentIntent initialisation for the same order.
- Refund creation without lock or idempotency key.
- Category A sellable on an identity card alone. → Decision above.
- Quote-request e-mails can be flooded.
- Newsletter confirmation token logged (GET query string).
- The CSP nonce is stamped on scripts injected through `v-html`.
- Umami exposed publicly with default credentials.
- Container images not pinned by digest.

## Remediation plan

Tracked in the BACKLOG (« Audit de sécurité du 2026-10-21 »): the three High
items first, one PR each, test-first; then the Mediums; the Lows before the
first deployment unless explicitly deferred there with a reason.
