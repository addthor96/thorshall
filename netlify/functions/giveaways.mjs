import { getStore } from "@netlify/blobs";
import handlerModule from "../lib/giveaway-handler.js";
import storeModule from "../lib/giveaway-store.js";

const { HEADERS, MAX_BODY_BYTES, authorize, createHandler } = handlerModule;
const handle = createHandler({ connectStore: event => storeModule.openStore(getStore, event) });

export default async function giveaways(request, context) {
  const event = {
    httpMethod: request.method, rawUrl: request.url,
    deployContext: context?.deploy?.context, published: context?.deploy?.published,
    headers: Object.fromEntries(request.headers), queryStringParameters: Object.fromEntries(new URL(request.url).searchParams), body: ""
  };
  const denial = authorize(event);
  if (denial) return new Response(denial.body, { status: denial.statusCode, headers: denial.headers });
  if (["POST", "PATCH"].includes(request.method) && request.body) {
    const reader = request.body.getReader(), chunks = []; let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          return new Response(JSON.stringify({ ok: false, error: "Giveaway update is too large." }), { status: 413, headers: HEADERS });
        }
        chunks.push(Buffer.from(value));
      }
      event.body = Buffer.concat(chunks).toString("utf8");
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "The giveaway request could not be read. Retry the same save." }), { status: 400, headers: HEADERS });
    } finally { reader.releaseLock(); }
  }
  const result = await handle(event);
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
}
