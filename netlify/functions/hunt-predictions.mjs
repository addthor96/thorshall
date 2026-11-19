import { getStore } from "@netlify/blobs";
import predictions from "../lib/hunt-predictions.js";
import hunts from "../lib/bonus-hunts.js";

const { HEADERS, MAX_BODY_BYTES } = predictions;
const handle = predictions.createHandler({
  connectHunts: event => getStore({ name: hunts.storeName(event), consistency: "strong" }),
  connectPredictions: event => getStore({ name: predictions.storeName(event), consistency: "strong" })
});

export default async function huntPredictions(request, context) {
  const event = {
    httpMethod: request.method, rawUrl: request.url,
    deployContext: context?.deploy?.context, published: context?.deploy?.published,
    clientIp: context?.ip,
    headers: Object.fromEntries(request.headers), queryStringParameters: Object.fromEntries(new URL(request.url).searchParams), body: ""
  };
  if (request.method === "POST" && request.body) {
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return new Response(JSON.stringify({ ok: false, error: "This prediction is too large." }), { status: 413, headers: HEADERS });
    const reader = request.body.getReader(), chunks = []; let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          return new Response(JSON.stringify({ ok: false, error: "This prediction is too large." }), { status: 413, headers: HEADERS });
        }
        chunks.push(Buffer.from(value));
      }
      event.body = Buffer.concat(chunks).toString("utf8");
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "The prediction could not be read. Retry the same prediction." }), { status: 400, headers: HEADERS });
    } finally { reader.releaseLock(); }
  }
  const result = await handle(event);
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
}
