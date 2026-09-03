# Thor's Hall universal-link rollout

## What changed

- Added `join.html` for `/join`.
- Replaced appropriate direct Rainbet links across the recovered live Thor's Hall pages with tracked `/join` links.
- Added a separate `src` value for each page so Netlify can show where each click came from.
- Preserved each partner's existing Rainbet campaign destination through an allowlisted `campaign` route.
- Routed the lower support-signup flows through `/join` while preserving the `addthor` referral destination.
- Left Aditya's pending main campaign buttons disabled. The strict Aditya signup-only rebuild remains for later.
- Included the five tracker pages with the previously completed 50% Estimated Payout update.

## Safe routing

The `/join` page accepts only these campaign routes:

- `main` — Thor's Hall master campaign
- `manuel` — Manuel's currently configured destination
- `arshan` — Arshan's campaign
- `radhika` — Radhika's campaign
- `piyush` — Piyush's campaign
- `mithra` — Mithra's campaign
- `techsslaash` — Techsslaash's campaign
- `support` — the `addthor` signup referral

Unknown campaign values fall back to `main`; arbitrary redirect URLs are not accepted.

## Share-link examples

- `https://thorshall.gg/join?src=youtube`
- `https://thorshall.gg/join?src=telegram`
- `https://thorshall.gg/join?src=newsletter`
- `https://thorshall.gg/join?src=partnername`

Partner landing pages use both a source and an allowlisted campaign route internally, for example:

- `/join?src=arshan&campaign=arshan`
- `/join?src=radhika&campaign=radhika`

## Tracking fields

Netlify form: `thorshall-join-click`

- `source`
- `campaign`
- `timestamp`
- `referrer`
- `destination`

## Deployment note

The ZIP contains updated HTML pages only. Merge these files into the existing Thor's Hall site source and deploy the complete site so existing images, scripts, Netlify Functions, and other assets remain present.
