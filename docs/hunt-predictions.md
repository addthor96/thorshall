# Hunt predictions

The public `/bonus-hunt` page accepts free end-balance guesses while its active hunt is collecting bonuses. The prediction section follows the selected hunt. It shows 1st, 2nd and 3rd place without prize amounts; completed hunts rank guesses by absolute distance from the displayed final end balance, with earlier submissions winning ties.

## Current identity and entry rules

- Viewers enter a Twitch username. This is not verified Twitch identity; OAuth sign-in is planned for a later update.
- One prediction per signed browser identifier and per case-insensitive username for each hunt. Browser resets and other devices cannot provide strict one-person enforcement.
- No email, purchase, deposit, account creation or payment is involved.
- Guesses and other entrants' usernames are hidden until the hunt is completed; only the final top three are public. The submitting browser can see its own entry.
- Entries close when bonus opening starts. A server-only immutable cutoff prevents reopening the entry window by returning a hunt to collection, removing/reusing an ID, or switching its active status.
- Predictions are recorded in the hunt's currency. If it changes after entries arrive, those entries cannot be ranked in the new currency; they resume only if the original currency is restored before opening. Setting up a fresh hunt's currency remains available.

## Storage and integration

`hunt-predictions.mjs` uses the existing Netlify Blobs integration. Predictions have their own per-hunt records so submissions do not change the editor's hunt revision or collide with normal hunt saves. The main hunt record retains only server cutoff metadata, which is excluded from public/owner response state. Conditional writes and server timestamps handle simultaneous entries and closure races. Preview storage is separated from production.

The existing session signing secret is used for pseudonymous browser and abuse-prevention identifiers. No new environment variable is required. No raw IP address or stream overlay token is returned by the predictions endpoint.

The prediction script loads once per selected hunt/status, after submission, or when Refresh predictions is pressed. It does not add a repeating polling loop. Its mount and typed draft survive ordinary hunt updates. Private/unavailable responses clear cached prediction data.

This update does not add homepage links or change the stream overlay.
