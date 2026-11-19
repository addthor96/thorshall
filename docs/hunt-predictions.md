# Hunt predictions

The public `/bonus-hunt` page accepts free end-balance guesses while its active hunt is collecting bonuses. The prediction section sits immediately below the page heading, above the hunt archive, and follows the selected hunt. It shows 1st, 2nd and 3rd place without prize amounts; completed hunts rank guesses by absolute distance from the displayed final end balance, with earlier submissions winning ties.

## Current identity and entry rules

- Viewers must sign in with Twitch before submitting. The server derives their Twitch user ID and login; a typed username cannot claim another account.
- One prediction per stable Twitch account ID for each hunt, across browsers and Twitch name changes. This limits accounts, not necessarily people with multiple accounts. Existing unverified historical entries remain separate and never claim ownership of a Twitch account.
- No email permission, purchase, deposit or payment is requested.
- Each eligible username and locked prediction amount appears in the public prediction list as soon as it is accepted. The viewer's own saved amount is also shown separately after Twitch sign-in. A saved prediction cannot be edited or replaced, including after a Twitch name change or sign-in from another browser. Final top-three rankings appear after the hunt finishes.
- The public roster contains only the username, prediction amount, acceptance timestamp, whether the entry used verified Twitch sign-in, and a viewer-specific own-entry flag. Legacy unverified historical entries are labelled separately. Twitch account IDs, request IDs and abuse-prevention hashes are never part of the public roster.
- Entries close when bonus opening starts. A server-only immutable cutoff prevents reopening the entry window by returning a hunt to collection, removing/reusing an ID, or switching its active status.
- Predictions are recorded in the hunt's currency. If it changes after entries arrive, those entries cannot be ranked in the new currency; they resume only if the original currency is restored before opening. Setting up a fresh hunt's currency remains available.

## Storage and integration

`hunt-predictions.mjs` uses the existing Netlify Blobs integration. Predictions have their own per-hunt records so submissions do not change the editor's hunt revision or collide with normal hunt saves. The main hunt record retains only server cutoff metadata, which is excluded from public/owner response state. Conditional writes and server timestamps handle simultaneous entries and closure races. Preview storage is separated from production.

The existing session signing secret protects Twitch session cookies and encrypts server-side access tokens. The app also needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, available only to Netlify Functions. No raw IP address, OAuth token or stream overlay token is returned by the predictions endpoint. See `docs/twitch-predictions-setup.md` for registration and activation.

The prediction script loads once per selected hunt/status, after submission, or when Refresh predictions is pressed. An unfinished hunt's roster refreshes at most once every 60 seconds while its panel is visible; hidden tabs, panels outside the viewport and completed hunts do not poll for roster updates. Every eligible entry is available in a four-row scroll area, which moves only down, resets to the top and pauses for two seconds. Hover, keyboard focus, manual controls and reduced-motion preferences pause automatic motion. The signed-in viewer's locked amount remains in a separate fixed card. Signed-in viewers receive an approximately hourly session check, with hidden tabs checked on return, to meet Twitch token-validation requirements. Its mount and typed draft survive ordinary hunt updates. Hunt switches dispose scroll/refresh timers, and private/unavailable responses clear cached prediction data.

This update does not add homepage links or change the stream overlay.
