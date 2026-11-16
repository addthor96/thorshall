# Bonus hunt manager

The public display is `/bonus-hunt`. The existing owner workspace remains `/admin`; choose **Bonus hunts** in the workspace navigation or Site tools to open `/admin?view=hunts`.

The manager uses the existing owner session. Creator sessions cannot open or edit hunts. It saves hunts in the site-scoped Netlify Blobs store `thorshall-bonus-hunts-v2`, independently of partner and payment records. Preview and unpublished deploys use separate stores. No new environment variables are required beyond the existing owner master password and signing secret.

Enter a starting balance and unspent cash balance, then add the slot name and bet for each bonus. When a bonus opens, enter its payout or X. Empty payout means unopened; `0` means opened with no return. Wait for **All changes saved** before relying on an update. End balance is unspent cash plus opened payouts. Required X is the remaining break-even amount divided by the unopened bonuses' total bet base. Average X is the mean multiplier of opened bonuses with a positive bet.

The selected hunt appears on the page and stream. Other completed hunts appear in page history. Inactive unfinished hunts remain private. The page launches public as requested; the owner can make its data private with the visibility button. Existing public navigation has not been changed.

## OBS / Streamlabs

1. Open the hunt manager and select **Copy overlay URL**.
2. Add a Browser Source in OBS or Streamlabs and paste the complete copied URL, including the `#token=` part.
3. Set the source to **520 × 960**. Its outer background is transparent.
4. Save a payout in the manager. The overlay refreshes about every three seconds; the page refreshes about every five seconds.

The overlay shows up to eight slots at once. While collecting, a longer list slowly scrolls down, pauses, and returns to the top. Once you start entering payouts, it returns to the top and follows each slot as you enter or correct its result. A payout of `0` counts as an opened bonus.

For a compact overlay, insert `?layout=compact` before `#token` and use 520 × 900. The overlay link permits viewing the active hunt only. It cannot edit hunts. **Replace overlay link** revokes the old token and requires updating the OBS source URL.

The overlay automatically fits smaller Browser Source canvases, but the recommended dimensions preserve full text size. After a website overlay update, refresh the OBS Browser Source once. The viewing URL and token remain the same.

Use Export hunts for JSON backups. Unsaved edits have browser-tab recovery. Conflicting saves from another tab are rejected rather than silently overwriting data. New empty storage shows an empty hunt to visitors without storing anything until the owner first opens the manager.

The deployment includes the private HTML view in both admin function bundles. Raw `/netlify/*` source paths are blocked by forced redirects. All server and browser checks are in `tests/`.
