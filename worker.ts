/**
 * Builtday B2 Signed URL Worker
 * Uses Backblaze B2 S3-compatible API to generate presigned upload URLs.
 */

interface Env {
  B2_ACCOUNT_ID: string;       // e87cd74ecb28
  B2_BUCKET_NAME: string;      // e.g. builtday-media
  B2_KEY_ID: string;           // B2 application key ID  (acts as AWS access key)
  B2_APP_KEY: string;          // B2 application key    (acts as AWS secret key)
  B2_REGION: string;           // e.g. us-west-004
}

// ── helpers ──────────────────────────────────────────────────────────────────

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
});

// Hex-encode a Uint8Array
const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// HMAC-SHA256
async function hmac(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const keyMaterial =
    typeof key === "string"
      ? new TextEncoder().encode(key)
      : new Uint8Array(key);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return hex(buf);
}

// ── presigned URL (AWS Signature V4) ─────────────────────────────────────────

async function createPresignedPutUrl(
  env: Env,
  key: string,           // object key inside the bucket
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const region = env.B2_REGION;                        // e.g. us-west-004
  const bucket = env.B2_BUCKET_NAME;
  const host   = `s3.${region}.backblazeb2.com`;
  const service = "s3";

  const now = new Date();
  const datestamp  = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const amzdate    = now.toISOString().replace(/[:-]|\.\d+/g, "").slice(0, 15) + "Z"; // YYYYMMDDTHHmmssZ

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const credential      = `${env.B2_KEY_ID}/${credentialScope}`;

  // Query-string parameters (must be sorted)
  const params = new URLSearchParams({
    "X-Amz-Algorithm":     "AWS4-HMAC-SHA256",
    "X-Amz-Credential":    credential,
    "X-Amz-Date":          amzdate,
    "X-Amz-Expires":       String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  });

  // Canonical request
  const canonicalUri        = `/${encodeURIComponent(bucket)}/${key}`;
  const canonicalQueryString = params.toString();
  const canonicalHeaders    = `host:${host}\n`;
  const signedHeaders       = "host";
  const payloadHash         = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzdate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join("\n");

  // Signing key
  const kDate    = await hmac(`AWS4${env.B2_APP_KEY}`, datestamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");

  const signature = hex(await hmac(kSigning, stringToSign));

  params.set("X-Amz-Signature", signature);

  // Public URL for reading the object afterwards
  const publicUrl = `https://${host}/${bucket}/${key}`;

  return `https://${host}${canonicalUri}?${params.toString()}`;
}

// ── route handlers ────────────────────────────────────────────────────────────

async function handleSignedUrl(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin") || "";

  try {
    const { projectId, filename, contentType } = await request.json<{
      projectId: string;
      filename: string;
      contentType?: string;
    }>();

    if (!projectId || !filename) {
      return new Response(
        JSON.stringify({ error: "projectId and filename required" }),
        {
          status: 400,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        }
      );
    }

    const key = `projects/${projectId}/${Date.now()}-${filename}`;
    const ct  = contentType || "application/octet-stream";

    const uploadUrl = await createPresignedPutUrl(env, key, ct);

    // The public read URL (assumes bucket is public or you use a CDN URL)
    const region    = env.B2_REGION;
    const publicUrl = `https://s3.${region}.backblazeb2.com/${env.B2_BUCKET_NAME}/${key}`;

    return new Response(
      JSON.stringify({ uploadUrl, publicUrl, key, expiresIn: 3600 }),
      {
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: "Failed to generate signed URL" }),
      {
        status: 500,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      }
    );
  }
}

// ── main fetch ────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const origin = request.headers.get("origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/signed-url" && request.method === "POST") {
      return handleSignedUrl(request, env);
    }

    if (url.pathname === "/health") {
      return new Response("OK", { headers: { "Content-Type": "text/plain" } });
    }

    return new Response("Not found", { status: 404 });
  },
};
