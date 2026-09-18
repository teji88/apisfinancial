# Free plan limits, Pro subscription, and invite codes

## What the user gets

**Free**: 1 account, up to 10 holdings. Everything else in the app works normally.

**Pro**: unlimited accounts and holdings. $1/month or $10/year.

**Invite codes**: you generate codes and hand them to friends and testers. Redeeming one gives full Pro access with no card, optionally with an end date.

## How the limits behave

- Adding a 2nd account, or an 11th holding, opens an upgrade window instead of saving. Nothing is hidden or deleted.
- If a paid subscription lapses, the whole app goes read-only for one month: everything stays visible, nothing can be added or edited. A banner and an email-style in-app notice explain this on first load after expiry.
- After that month, it stays read-only until they resubscribe. Data is never deleted.
- Invite-code access behaves exactly like Pro while it lasts, and follows the same read-only grace if an end date passes.

## Pages and screens

- **Pricing / Upgrade dialog** — Free vs Pro, monthly and yearly toggle, "Start Pro" button, and a "Have an invite code?" field.
- **Header profile menu** — shows current plan; "Manage subscription" opens the Stripe billing portal for paying users.
- **Admin screen (you only)** — create invite codes (count, optional expiry, optional note), see who redeemed each one, revoke unused codes.
- **Banners** — a soft counter near the account/holding limits ("10 of 10 holdings used") and a red read-only banner after a lapse.

## Technical notes

**Payments**: Lovable's built-in Stripe (seller country Canada, tax calculated and collected). Two products: Pro Monthly $1 CAD and Pro Yearly $10 CAD. Checkout via a server function; a webhook at `src/routes/api/public/stripe-webhook.ts` verifies the signature and writes subscription state.

**Database** (migration, with GRANTs + RLS):
- `subscriptions` — user_id, status (`active`/`past_due`/`canceled`), plan (`monthly`/`yearly`/`comp`), current_period_end, grace_until, stripe_customer_id, stripe_subscription_id. Users read their own row; only the webhook (service role) writes.
- `invite_codes` — code, created_by, max_uses, uses, expires_at, access_until, revoked, note.
- `invite_redemptions` — code_id, user_id, redeemed_at.
- `user_roles` + `app_role` enum + `has_role()` security-definer function, so the admin screen is server-verified (not a client flag).

**Entitlement**: a single `useEntitlement()` hook backed by a server function returning `{ tier, readOnly, accountLimit, holdingLimit }`. Limits are enforced twice — in the UI for the dialog, and again server-side in the insert path so the cap cannot be bypassed.

**Enforcement points**: `useAddAccount`, `ensureHolding` / `useAddTransaction`, the AI import commit, and edit/delete mutations (blocked while read-only).

## Order of work

1. Enable Stripe, create the two products.
2. Migration: subscriptions, invite codes, roles.
3. Entitlement hook + server-side limit checks.
4. Checkout, webhook, billing portal.
5. Upgrade dialog, banners, invite-code redemption.
6. Admin invite-code screen.
