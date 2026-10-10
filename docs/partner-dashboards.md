# Numbered partner dashboards

The public landing page uses `/tN`; the private dashboard uses `/tN-dashboard`.
All dashboards share one template, stats endpoint, and login. Campaign codes stay assigned to the same partner.

| Code | Partner | Rainbet campaign | Landing | Dashboard |
|---|---|---|---|---|
| T2 | Swagat Nayak | 150649 | /t2 | /t2-dashboard |

T1 remains the existing Motion review Agency landing page (campaign 130933). Its dashboard is not provisioned by this change. T3 onward are unassigned.

## Configuration

Keep credentials in Netlify environment variables, never in GitHub or frontend code:

- `RAINBET_STATISTIC_TOKEN`: the existing reporting token, used only by server functions.
- `STATS_SESSION_SECRET`: existing signing secret of at least 32 characters (the existing `DASHBOARD_SESSION_SECRET` fallback is supported). Do not replace a working secret unnecessarily.
- `STATS_PASSWORD_T2`: a unique, strong password for Swagat's dashboard. Share privately with Swagat after confirming login.
- Existing `STATS_ADMIN_PASSWORD`, `STATS_DASHBOARD_PASSWORD`, or `DASHBOARD_PASSWORD`: owner access; never share the owner password with partners.

Variables must be available to production Functions. A new production deploy is needed after variable changes. Without configured authentication the page stays closed. Owner authentication may work before the individual partner password has been set.

## Add the next assigned campaign

1. Confirm the permanent T code, partner name, campaign ID and campaign URL.
2. Add it to `netlify/lib/partner-campaigns.js`.
3. Add explicit `/tN-dashboard` rewrite and `.html`/trailing-slash canonical redirects to `_redirects`; add corresponding noindex entries to `_headers`.
4. Set `STATS_PASSWORD_TN` in Netlify. Login scope and return URL are automatically derived from the registry.
5. Deploy and verify both the page and stats endpoint reject anonymous and other-partner sessions.

Do not duplicate the dashboard template or allow visitors to provide arbitrary Rainbet campaign IDs.

## Reporting

The default period is the current UTC month. Other filters are today, the last seven UTC calendar days including today, and all time. Totals come only from the assigned Rainbet campaign. In-memory report caching may delay visible updates by up to five minutes; every request is authorized before cache access. HTML and API responses use private/no-store headers.

Unavailable report values are not replaced with zero. Payable earnings are not inferred from NGR: they require the final affiliate commission actually received and the partner agreement. This release does not contain a payout ledger or confirmed commission data source.

T2's bottom `addthor` personal referral is outside campaign 150649 reporting. Netlify click forms remain separate from operator registrations/deposits. No usernames or individual player records are requested or exposed here.

## Validation

Run `node --test tests/partner-*.test.js` from the repository root. Tests use local fixture credentials and mocked reports; they do not contact Rainbet or create real activity. Verify Netlify deployment logs apply the login rate-limit configuration.

This addition does not migrate or secure legacy stats pages; it gates the new numbered dashboard and its data endpoint.
