import backend from "../lib/bonus-hunts.js";

const handle = backend.createHandler();

// The modern Functions API supplies the complete Blobs context, including the
// uncached endpoint needed for strong reads. Do not convert this to a Lambda handler.
export default async function(request, context) {
  const url = new URL(request.url);
  const result = await handle({
    httpMethod: request.method,
    deployContext: context?.deploy?.context,
    published: context?.deploy?.published,
    headers: Object.fromEntries(request.headers),
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: ["GET", "HEAD"].includes(request.method) ? "" : await request.text()
  });
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
}

