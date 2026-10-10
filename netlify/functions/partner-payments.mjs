import { getStore } from "@netlify/blobs";
import handlerModule from "../lib/partner-payment-handler.js";
import storeModule from "../lib/partner-payment-store.js";

// Modern Netlify Functions automatically receive the Blobs context, including
// the uncached endpoint required for strongly consistent reads.
const { createHandler, MAX_BODY_BYTES } = handlerModule;
const { openStore } = storeModule;
// An explicit static import ensures the modern Function bundle contains the
// SDK. Opening its store still happens only after the handler authorizes access.
const handle = createHandler({ connectStore: () => openStore(getStore) });

export default async function partnerPayments(request, context) {
  const url = new URL(request.url);
  let body = "";
  if (request.method !== "GET" && request.body) {
    const reader = request.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          return new Response(JSON.stringify({ ok: false, error: "Payment request is too large." }), {
            status: 413, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", Vary: "Cookie" }
          });
        }
        chunks.push(Buffer.from(value));
      }
      body = Buffer.concat(chunks).toString("utf8");
    } finally { reader.releaseLock(); }
  }
  const result = await handle({
    httpMethod: request.method,
    rawUrl: request.url,
    deployContext: context?.deploy?.context,
    headers: Object.fromEntries(request.headers),
    queryStringParameters: Object.fromEntries(url.searchParams),
    body
  });
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
}
