# Hunt predictions

The public `/bonus-hunt` page accepts free end-balance guesses while its active hunt is collecting bonuses. The prediction section sits immediately below the page heading, above the hunt archive, and follows the selected hunt. It shows 1st, 2nd and 3rd place without prize amounts; completed hunts rank guesses by absolute distance from the displayed final end balance, with earlier submissions winning ties.

## Current identity and entry rules

- Viewers must sign in with Twitch before submitting. The server derives their Twitch user ID and login; a typed username cannot claim another account.
- One prediction per stable Twitch account ID for each hunt, across browsers and Twitch name changes. This limits accounts, not necessarily people with multiple accounts. Existing unverified historical entries remain separate and never claim ownership of a Twitch account.
- No email permission, purchase, deposit or payment is requested.
- Guesses and other entrants' usernames are hidden until the hunt is completed; only the final top three are public. The submitting browser can see its own entry.
- Entries close when bonus opening starts. A server-only immutable cutoff prevents reopening the entry window by returning a hunt to collection, removing/reusing an ID, or switching its active status.
- Predictions are recorded in the hunt's currency. If it changes after entries arrive, those entries cannot be ranked in the new currency; they resume only if the original currency is restored before opening. Setting up a fresh hunt's currency remains available.

## Storage and integration

`hunt-predictions.mjs` uses the existing Netlify Blobs integration. Predictions have their own per-hunt records so submissions do not change the editor's hunt revision or collide with normal hunt saves. The main hunt record retains only server cutoff metadata, which is excluded from public/owner response state. Conditional writes and server timestamps handle simultaneous entries and closure races. Preview storage is separated from production.

The existing session signing secret protects Twitch session cookies and encrypts server-side access tokens. The app also needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, available only to Netlify Functions. No raw IP address, OAuth token or stream overlay token is returned by the predictions endpoint. See `docs/twitch-predictions-setup.md` for registration and activation.

The prediction script loads once per selected hunt/status, after submission, or when Refresh predictions is pressed. It adds no fast polling loop. Signed-in viewers receive an approximately hourly session check, with hidden tabs checked on return, to meet Twitch token-validation requirements. Its mount and typed draft survive ordinary hunt updates. Private/unavailable responses clear cached prediction data.

This update does not add homepage links or change the stream overlay.
