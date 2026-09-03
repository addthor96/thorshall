# Thor's Hall safe rebuild

This folder is a complete Netlify deploy package. Deploy the folder itself (not a folder above it) to replace the current site.

## Completed rollout

- Removed the personal founder biography, phone number, personal photographs, location branding, and unrelated external-project links.
- Replaced the About page with a minimal site-operator and controller contact section.
- Added `/privacy` and privacy notices to every Netlify form.
- Removed Google Analytics and copied Netlify RUM tags. The package does not load non-essential browser analytics, so there is no consent banner that pretends to control tags which have already loaded.
- Finished allowlisted `/join` routing. Every public Rainbet call-to-action now enters through `/join`; only `join.html` contains the external campaign destinations.
- Limited the stored referrer to origin and path. Query strings and fragments are not submitted.
- Preserved the confirmed 250% campaign pages and added a live-terms/eligibility qualifier.
- Restored Netlify form-detection and honeypot attributes on all forms.
- Protected Rainbet partner statistics with an eight-hour HTTP-only session cookie and disabled public/CDN caching for those APIs.
- Kept all five requested tracker payouts at 50% of the estimated Rainbet commission.
- Removed public live-stat widgets and made the partner ledger privacy-safe.
- Fixed missing background-asset references.
- Added HSTS, CSP, permissions, content-type, framing, referrer, and private-cache headers.
- Removed obsolete test, training experiment, and `tilraun` builds plus the unfinished `aditya-signup.html` build. The Aditya strict signup/screenshot system remains intentionally deferred.
- Removed the dedicated Rainbet/casino SEO landing-page cluster and returns HTTP 410 for its previous paths.
- Removed the founder-photo files from the deploy package.

## `/join` routes

The route accepts only the allowlisted campaign key. Unknown values fall back to `main`; arbitrary destinations cannot be supplied in the URL.

- `main` and `manuel` → `https://playrainbet.com/tkpmo0r1x`
- `arshan` → `https://playrainbet.com/t2uog2tzs`
- `radhika` → `https://playrainbet.com/t0qmfuqvw`
- `piyush` → `https://playrainbet.com/t7ayt4zbl`
- `mithra` → `https://playrainbet.com/toaehjy8o`
- `georgina` → `https://playrainbet.com/ts5ttmsbr`
- `techsslaash` → `https://playrainbet.com/twf35cati`
- `support` → `https://rainbet.com?r=addthor`

Examples:

- `https://thorshall.gg/join?src=youtube`
- `https://thorshall.gg/join?src=telegram`
- `https://thorshall.gg/join?src=partnername`
- `https://thorshall.gg/join?src=arshan&campaign=arshan`

Netlify form name: `thorshall-join-click`

Stored fields: `source`, `campaign`, `timestamp`, limited `referrer`, and `destination`.

## Required Netlify environment variables

Do not put these values in HTML or commit them into the folder.

- `RAINBET_STATISTIC_TOKEN` — existing Rainbet reporting token.
- `STATS_DASHBOARD_PASSWORD` — strong password shared only with authorized partners/admins.
- `STATS_SESSION_SECRET` — random secret of at least 32 bytes used to sign sessions.

The statistics code also accepts the existing `DASHBOARD_PASSWORD` and `DASHBOARD_SESSION_SECRET` names as fallbacks. Dedicated `STATS_*` values are preferred.

Optional campaign-ID variables already supported by the existing functions should remain configured. Google Search Console functions keep their existing environment-variable requirements.

Private tracker paths:

- `/manuel-stats1`
- `/piyush-stats1`
- `/radhika-stats1`
- `/aditya-stats1`
- `/arshan-stats1`

Opening a tracker without a valid session sends the visitor to the private statistics login.

## Operational privacy tasks

- Delete or anonymize join-attribution submissions after 90 days unless needed for an active reconciliation or dispute.
- Review and delete application/support submissions after 12 months unless an active relationship or legal obligation requires longer retention.
- Confirm that **Thor's Hall** is the correct legal controller name. If it is only a brand, replace the public controller label with the real legal person/entity and any address or registration details required by the laws that apply to the operator.
- Keep the contact email working and monitor privacy requests.

Removing unnecessary location branding improves privacy, but it does not change which laws apply to the person or business operating the site.

## Deployment check

After uploading, verify:

1. `/join?src=deployment-test` creates a `thorshall-join-click` submission and redirects to the main campaign.
2. Each partner page reaches its intended allowlisted campaign.
3. A private tracker prompts for the statistics password, then loads after login.
4. All application/support forms appear in Netlify Forms and submit to `/thanks` or their intended support flow.
5. Removed SEO URLs return 410 and no longer appear in `sitemap.xml`.
