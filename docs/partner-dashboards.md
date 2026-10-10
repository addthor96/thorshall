# Numbered partner dashboards

The public landing page uses `/tN`; the private dashboard uses `/tN-dashboard`.
All dashboards share one template, stats endpoint, and login. Campaign codes stay assigned to the same partner.

| Code | Partner | Rainbet campaign | Landing | Dashboard |
|---|---|---|---|---|
| T1 | Motion review Agency | 130933 | /t1 | /t1-dashboard |
| T2 | Swagat Nayak | 150649 | /t2 | /t2-dashboard |

T1 and T2 use the same protected dashboard. T3 onward are unassigned. Public landing pages are independent and are not changed by dashboard updates.

## Owner admin hub

`/admin` is the owner's central workspace. It uses the existing master statistics password and signed session. Partner passwords and partner sessions cannot open the hub or its private data endpoint. An owner session can move between the hub and any numbered dashboard without signing in again. Owner-only **Admin home** links return from individual dashboards to the hub. The separate existing Search Console and signup-review tools retain their own sign-in behavior.

The hub lists every partner in the server campaign registry, supports name/code/campaign-ID search, and provides landing-page, tracked-link, dashboard and payment-history access. It shows whether each individual partner password is configured without returning any credential. Current-month Rainbet activity and recorded payments load from the existing protected endpoints; unavailable sources are labeled instead of replaced with zero or an empty ledger.

Private workflow labels and notes help organize follow-ups. These are stored in the separate site-wide `thorshall-admin-partners-v1` Blobs store and survive deployments. Changes use a checked revision and conditional writes. A workflow label such as **On hold** is organizational only: it does not disable a campaign, stop tracking, hide a landing page, alter partner access or change payment terms. Notes never appear in partner views.

Future registered T campaigns appear automatically in the hub once their page, registry entry, route and credential are set up. This release does not edit public-page content, create Rainbet campaigns, or set passwords through the hub. Use the setup links for existing hosting controls; never place provider tokens or passwords in notes.

## Configuration

Keep credentials in Netlify environment variables, never in GitHub or frontend code:

- `RAINBET_STATISTIC_TOKEN`: the existing reporting token, used only by server functions.
- `STATS_SESSION_SECRET`: existing signing secret of at least 32 characters (the existing `DASHBOARD_SESSION_SECRET` fallback is supported). Do not replace a working secret unnecessarily.
- `STATS_PASSWORD_T1`: the individual password for Motion review Agency's dashboard.
- `STATS_PASSWORD_T2`: the individual password for Swagat's dashboard. Share partner passwords privately after confirming login.
- Existing `STATS_ADMIN_PASSWORD`, `STATS_DASHBOARD_PASSWORD`, or `DASHBOARD_PASSWORD`: owner access; never share the owner password with partners.

Variables must be available to production Functions. A new production deploy is needed after variable changes. Without configured authentication the page stays closed. Owner authentication may work before the individual partner password has been set.

## Add the next assigned campaign

1. Confirm the permanent T code, partner name, campaign ID and campaign URL.
2. Add it to `netlify/lib/partner-campaigns.js`.
3. Add an explicit `/tN-dashboard` rewrite and `.html` canonical redirect to `_redirects`; add corresponding noindex entries to `_headers`. Do not add a `/tN-dashboard/` → `/tN-dashboard` redirect: Netlify normalizes trailing slashes during matching and that rule can loop.
4. Set `STATS_PASSWORD_TN` in Netlify. Login scope and return URL are automatically derived from the registry.
5. Deploy and verify both the page and stats endpoint reject anonymous and other-partner sessions.

Do not duplicate the dashboard template or allow visitors to provide arbitrary Rainbet campaign IDs.

## Reporting

The default period is the current UTC month. Other filters are today, the last seven UTC calendar days including today, and all time. Totals come only from the assigned Rainbet campaign. In-memory report caching may delay visible updates by up to five minutes; every request is authorized before cache access. HTML and API responses use private/no-store headers.

Unavailable report values are not replaced with zero. Payable earnings are not inferred from NGR: they require the final affiliate commission actually received and the partner agreement. The payment history records payments the owner has already sent; it does not calculate commission or transfer money.

T2's bottom `addthor` personal referral is outside campaign 150649 reporting. Netlify click forms remain separate from operator registrations/deposits. No usernames or individual player records are requested or exposed here.

## Record monthly payments

Use the same password field for partner and owner access. A partner password grants read-only access to that partner's report and payment history. The configured owner password grants master access across T1 and T2, with payment controls and a partner switcher rendered only for the owner. If already signed in as a partner, sign out before entering the owner password.

After sending a payment, open that partner's dashboard as owner, choose **Record payment**, enter the reporting month, amount paid, currency, payment date and optional transaction reference, then save. Saved entries appear in that partner's read-only history. Corrections retain previous revisions. No existing earnings or payment amounts are seeded, estimated or inferred from campaign NGR.

Payment records are stored in a private site-wide Netlify Blobs store, outside GitHub and outside individual deploys. A redeploy does not reset the ledger. Only the authenticated owner can create or correct records; partner sessions cannot mutate them even by calling the endpoint directly. Concurrent corrections are checked against the entry revision, and retries of a payment save use the same request identifier to avoid duplicate entries. Payment history loads independently from Rainbet reports.

Production credentials are managed in Netlify; do not add storage credentials to the repository. The payment function uses Netlify's runtime-provided storage context. Do not test payment writes against real partner ledgers with fictitious amounts. Use local fixtures for write/conflict tests and verify the live ledger with a read-only request.

## Validation

Run `node --test tests/partner-*.test.js tests/admin-*.test.js` from the repository root. Tests use local fixture credentials and mocked reports; they do not contact Rainbet or create real activity. Verify Netlify deployment logs apply the login rate-limit configuration.

This addition does not migrate or secure legacy stats pages; it gates the new numbered dashboard and its data endpoint.
