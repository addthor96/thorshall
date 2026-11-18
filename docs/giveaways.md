# Owner giveaway ledger

The admin workspace records completed giveaways in USD and displays one shared total. Open `/admin`, then use **Giveaways** in the tools or sticky navigation. Enter the completed amount and choose **Record giveaway**. The total changes after storage confirms the save. Recent records have **Undo** for mistakes; undo retains the entry in the audit history. This release has no public giveaway endpoint and does not add anything to the home page. The same saved total is ready to supply a future public tracker once homepage placement and public access are enabled. Only a signed owner (`admin`) session may read or change giveaway records; creator sessions cannot access them.

## Amounts and totals

- Enter the completed amount as a decimal string, for example `"12.34"`.
- Amounts must be greater than zero, at most USD 100,000,000, and use no more than two decimal places. Numbers, negative values, exponent notation and rounding extra precision are rejected.
- All calculations and storage use whole cents. The reported total and count include every recorded entry, excluding entries that were undone.
- Undo marks the original entry `void` and retains its amount, creation timestamp and undo timestamp. Its operation history is retained; no record is deleted.

## Private API

`/.netlify/functions/giveaways` supports:

| Method | Request | Result |
| --- | --- | --- |
| GET | No query parameters or body | Owner ledger summary and latest 20 entries |
| POST | `{requestId: "<UUID v4>", amount: "12.34"}` | Record one completed giveaway; 201 when newly saved |
| PATCH | `{requestId: "<new UUID v4>", entryId: "<entry ID>", expectedRevision: 3}` | Undo one entry if revision 3 is still current |

Every success response includes `ok`, `currency: "USD"`, `totalMinor`, `count`, integer `revision`, and `entries`, ordered newest first. Entries contain `id`, `amountMinor`, `createdAt`, `status: "recorded" | "void"`, and optional `voidedAt`. Responses contain at most 20 entries; summary totals cover the full ledger. Mutation responses also include `duplicate`.

Writes require the signed owner cookie, an exact same-origin `Origin`, JSON content type, and `X-Thorshall-Request: giveaways`. A UUID identifies one intended operation. Retrying the same request ID and payload after a lost response returns 200 without adding or undoing twice. Reusing it for different details returns 409. A retry of an original POST after undoing that entry never restores it.

The client must keep the same request ID and unchanged payload until the save is confirmed. A failed request may already have reached storage. For an undo conflict, reload the current ledger and let the owner review it before creating a new undo request.

## Storage and deployment

The modern Netlify function statically imports the existing `@netlify/blobs` dependency. No additional environment variables or filesystem fallback are used. Existing owner login variables must be available to Functions.

The production site-wide store is `thorshall-giveaways-v1`. It is selected only for verified, currently published production requests on `https://thorshall.gg`. Preview hosts, unpublished deployments, branch deployments and local development receive separately suffixed stores, and cannot read or write the production ledger. Preview entries do not become production records when the deployment is published.

A single private ledger object contains records, exact totals and operation history. Strong reads, conditional ETag writes, bounded conflict retries and an immediate strong confirmation read protect concurrent additions and uncertain save responses. Undo requires the ledger's current integer revision. The ledger allows 5,000 entries and retains operation IDs for every entry/undo. Storage failures or corrupt data return 503 with no invented zero total; a successful read confirming a missing ledger returns the genuine empty summary.

Deploy through the project's existing Netlify build/Functions workflow after dependencies are installed; a static HTML-only upload is not sufficient to run this API.

References: [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Netlify Functions](https://docs.netlify.com/build/functions/get-started/).

## Verification

Run `node --test tests/giveaways.test.cjs tests/admin-giveaways-ui.test.cjs tests/admin-ui.test.js`. Tests cover signed roles, exact cents, operation retries/lost responses, concurrent additions, void history and stale revisions, storage failures, private responses, preview isolation, bounded modern requests, reciprocal session expiry, and clearing private data during browser navigation. Both private admin scripts share a session-expired event; neither stores ledger details in browser storage.
