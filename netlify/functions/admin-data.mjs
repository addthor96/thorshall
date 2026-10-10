import { getStore } from "@netlify/blobs";
import handlerModule from "../lib/admin-data-handler.js";
import storeModule from "../lib/admin-partner-store.js";

// Keep the SDK import in this modern entry so Netlify bundles it and supplies
// its native Blobs context. Storage opens only after owner authorization.
const { createHandler, HEADERS, MAX_BODY_BYTES } = handlerModule;
const { openStore } = storeModule;
const handle = createHandler({ connectStore: () => openStore(getStore) });

export default async function adminData(request, context) {
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
          return new Response(JSON.stringify({ ok: false, error: "Partner update is too large." }), { status: 413, headers: HEADERS });
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
