import { getStore } from "@netlify/blobs";
import auth from "../lib/hunt-twitch-auth.js";

const handle = auth.createHandler({ connectStore: event => getStore({ name: auth.storeName(event), consistency: "strong" }) });

export default async function huntTwitch(request, context) {
  const url = new URL(request.url);
  const known = new Set(["action", "return", "state", "code", "error", "error_description", "scope"]);
  for (const key of url.searchParams.keys()) {
    if (!known.has(key) || url.searchParams.getAll(key).length !== 1) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid Twitch request." }), { status: 400, headers: auth.HEADERS });
    }
  }
  const result = await handle({ httpMethod: request.method, rawUrl: request.url, headers: Object.fromEntries(request.headers),
    queryStringParameters: Object.fromEntries(url.searchParams), deployContext: context?.deploy?.context, published: context?.deploy?.published, clientIp: context?.ip });
  const headers = new Headers(result.headers);
  for (const cookie of result.cookies || []) headers.append("Set-Cookie", cookie);
  return new Response(result.body, { status: result.statusCode, headers });
}
