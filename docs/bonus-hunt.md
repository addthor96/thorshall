# Bonus hunt manager

The public display is `/bonus-hunt`. The existing owner workspace remains `/admin`; choose **Bonus hunts** in the workspace navigation or Site tools to open `/admin?view=hunts`.

The manager uses the existing owner session. Creator sessions cannot open or edit hunts. It saves hunts in the site-scoped Netlify Blobs store `thorshall-bonus-hunts-v2`, independently of partner and payment records. Preview and unpublished deploys use separate stores. No new environment variables are required beyond the existing owner master password and signing secret.

The manager follows three steps:

The hunt name is an editable field at the top in every phase. **Rename** beside the active-hunt selector jumps to this field and selects the existing name, ready to replace. The dropdown chooses which hunt is active. Renaming uses the same automatic save as other edits and updates the public hunt card. The manager omits the introductory heading and numbered stage strip.

1. **Collect bonuses.** Enter the starting balance and currency, then type a slot name and bet beside **Add bonus**. Each bonus becomes a compact entry below. The slot field clears and keeps the last bet ready for the next bonus. Date and any unspent cash are available under the optional hunt details.
2. **Open bonuses.** Once collection is finished, choose **Start opening bonuses** at the top beside **New hunt**. The manager saves first, then atomically closes predictions and replaces the collection fields with one focused payout card. Type the payout and choose **Save payout & next**, or press Enter. Empty payout means unopened; `0` means opened with no return. The next unopened bonus appears only after the payout saves. Previous/next buttons and the compact results list let you select a bonus to correct. **Back to hunting** at the top returns to collection and reopens predictions in one action without clearing recorded payouts or accepted guesses. Completed hunts remain closed when reviewing payouts.
3. **Finish hunt.** When every bonus has a saved payout, **Finish hunt** becomes available. It saves the completed hunt and shows the final balance and profit/loss. Choose **Start a new hunt** for the next session.

Wait for **All changes saved** before relying on an update. A failed save keeps the current bonus and draft in place; choose **Retry save** before continuing. Conflicting saves require loading the latest version, with a draft export available first. End balance is unspent cash plus opened payouts. Required X is the remaining break-even amount divided by the unopened bonuses' total bet base. Average X is the mean multiplier of opened bonuses with a positive bet.

The active hunt selected by the owner appears on the stream and opens by default on the public page. `/bonus-hunt` has a row of clickable hunt cards showing status, profit/loss, starting and ending balances, and bonus progress. The active hunt comes first, followed by completed hunts from newest to oldest. Use the arrows or swipe to browse the row, then choose a card to see its complete bonus list and results. The chosen hunt has a shareable `#hunt=ID` address and stays selected during automatic refreshes. Browsing a completed hunt only changes that visitor's view; it never changes the owner's active hunt or the stream. Inactive unfinished hunts remain private. The owner can make the page data private with the visibility button.

## OBS / Streamlabs

1. Open the hunt manager and select **Copy overlay URL**.
2. Add a Browser Source in OBS or Streamlabs and paste the complete copied URL, including the `#token=` part.
3. Set the source to **520 × 960**. Its outer background is transparent.
4. Save a payout in the manager. The overlay refreshes about every three seconds; the page refreshes about every five seconds.

The overlay shows up to eight slots at once. While collecting, a longer list only scrolls downward. At the end it instantly resets to the top, pauses for two seconds, and scrolls down again. Once you start entering payouts, it returns to the top and follows each slot as you enter or correct its result. A payout of `0` counts as an opened bonus.

The bar below THOR'S HALL replaces the hunt-title line. It shows the total collected and the count opened. Each opened bonus fills an equal share: 5 opened out of 40 bonuses fills 12.5%. Unopened bonuses have an empty payout; a zero payout still advances the bar.

For a compact overlay, insert `?layout=compact` before `#token` and use 520 × 900. The overlay link permits viewing the active hunt only. It cannot edit hunts. **Replace overlay link** revokes the old token and requires updating the OBS source URL.

The overlay automatically fits smaller Browser Source canvases, but the recommended dimensions preserve full text size. After a website overlay update, refresh the OBS Browser Source once. The viewing URL and token remain the same.

Use Export hunts for JSON backups. Unsaved edits have browser-tab recovery. Conflicting saves from another tab are rejected rather than silently overwriting data. New empty storage shows an empty hunt to visitors without storing anything until the owner first opens the manager.

The deployment includes the private HTML view in both admin function bundles. Raw `/netlify/*` source paths are blocked by forced redirects. All server and browser checks are in `tests/`.
