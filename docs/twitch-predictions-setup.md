# Activate Twitch sign-in for predictions

## Twitch application

Register a confidential website application owned by the Thor's Hall Twitch account at https://dev.twitch.tv/console/apps. Twitch requires verified email, two-factor authentication and its registration challenge. The application name appears when viewers authorize sign-in; use a name such as `Thor's Hall Predictions`.

Register this exact OAuth redirect URL:

```
https://thorshall.gg/.netlify/functions/hunt-twitch?action=callback
```

Use the Client ID and Client Secret from this application. Do not reuse another website's credentials or expose the secret in a page, repository or chat.

## Netlify configuration

Add these environment variables to the Thor's Hall Netlify project's **Functions** scope and **Production** context:

- `TWITCH_CLIENT_ID`: the application's client ID.
- `TWITCH_CLIENT_SECRET`: the application's client secret; mark it as containing secret values.

Keep the existing `STATS_SESSION_SECRET` unchanged. No new signing password is needed. Redeploy after saving the variables. Production uses the fixed registered callback above; `TWITCH_REDIRECT_URI` is only for an explicitly registered local/preview callback and must match that environment's origin.

## Verification

1. Open `/bonus-hunt` signed out. Predictions should be near the top, with a Twitch sign-in button and no editable username.
2. Sign in through Twitch. Check that the returned handle matches your Twitch account and the selected hunt is preserved.
3. Submit a guess during collection, then use Change prediction to save a new amount. The same account keeps one current guess across browsers; an outdated edit must refresh before it can replace a newer save.
4. Start opening bonuses and confirm predictions remain editable. Click Close predictions for that hunt in the manager and confirm both new entries and edits lock. Finishing the hunt also closes predictions automatically; confirm the closest three final saved guesses are ranked.
5. Sign out and confirm the entry form is replaced by the sign-in prompt.

Without the Twitch app variables, the feature fails closed: the page and podium remain available, but new predictions cannot be submitted. Local tests use a clearly isolated fake Twitch provider and throwaway session storage; these do not enable a production bypass.

## Session handling

Sessions use a separate server-side Blobs store and an opaque signed HttpOnly cookie. Twitch access tokens are encrypted at rest, used only by server code, and checked at login and at least hourly when sessions are used. Refresh tokens are not retained. Sessions expire at the earlier of eight hours or Twitch token expiry, and detected revocation or sign-out removes the session. Records that are no longer used may require maintenance to physically remove encrypted expired data.
