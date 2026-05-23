addEventListener("fetch", function(event) {
  event.respondWith(handleRequest(event.request));
});

function getCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function hexEncode(buf) {
  var bytes = new Uint8Array(buf);
  var result = "";
  for (var i = 0; i < bytes.length; i++) {
    result += ("0" + bytes[i].toString(16)).slice(-2);
  }
  return result;
}

function hmacSign(key, data) {
  var keyMaterial;
  if (typeof key === "string") {
    keyMaterial = new TextEncoder().encode(key);
  } else {
    keyMaterial = new Uint8Array(key);
  }
  return crypto.subtle.importKey(
    "raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  ).then(function(cryptoKey) {
    return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  });
}

function sha256Hash(data) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)).then(function(buf) {
    return hexEncode(buf);
  });
}

function buildPresignedUrl(key, expiresIn) {
  var region  = B2_REGION;
  var bucket  = B2_BUCKET_NAME;
  var keyId   = B2_KEY_ID;
  var appKey  = B2_APP_KEY;
  var host    = "s3." + region + ".backblazeb2.com";

  var now = new Date();
  var datestamp = now.toISOString().slice(0,10).replace(/-/g,"");
  var amzdate   = now.toISOString().replace(/[:-]|\.\d+/g,"").slice(0,15) + "Z";

  var scope      = datestamp + "/" + region + "/s3/aws4_request";
  var credential = keyId + "/" + scope;

  var qs = "X-Amz-Algorithm=AWS4-HMAC-SHA256"
    + "&X-Amz-Credential=" + encodeURIComponent(credential)
    + "&X-Amz-Date=" + amzdate
    + "&X-Amz-Expires=" + (expiresIn || 3600)
    + "&X-Amz-SignedHeaders=host";

  var canonicalUri     = "/" + encodeURIComponent(bucket) + "/" + key;
  var canonicalHeaders = "host:" + host + "\n";
  var canonicalRequest = "PUT\n" + canonicalUri + "\n" + qs + "\n" + canonicalHeaders + "\nhost\nUNSIGNED-PAYLOAD";

  return sha256Hash(canonicalRequest).then(function(crHash) {
    var stringToSign = "AWS4-HMAC-SHA256\n" + amzdate + "\n" + scope + "\n" + crHash;
    return hmacSign("AWS4" + appKey, datestamp).then(function(kDate) {
      return hmacSign(kDate, region).then(function(kRegion) {
        return hmacSign(kRegion, "s3").then(function(kService) {
          return hmacSign(kService, "aws4_request").then(function(kSigning) {
            return hmacSign(kSigning, stringToSign).then(function(sigBuf) {
              var sig = hexEncode(sigBuf);
              var url = "https://" + host + canonicalUri + "?" + qs + "&X-Amz-Signature=" + sig;
              return url;
            });
          });
        });
      });
    });
  });
}

function handleRequest(request) {
  var url    = new URL(request.url);
  var origin = request.headers.get("origin") || "";

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(origin) });
  }

  if (url.pathname === "/api/signed-url" && request.method === "POST") {
    return request.json().then(function(body) {
      var projectId   = body.projectId;
      var filename    = body.filename;
      var contentType = body.contentType || "application/octet-stream";

      if (!projectId || !filename) {
        return new Response(
          JSON.stringify({ error: "projectId and filename required" }),
          { status: 400, headers: Object.assign({}, getCorsHeaders(origin), { "Content-Type": "application/json" }) }
        );
      }

      var key = "projects/" + projectId + "/" + Date.now() + "-" + filename;

      return buildPresignedUrl(key, 3600).then(function(uploadUrl) {
        var publicUrl = "https://s3." + B2_REGION + ".backblazeb2.com/" + B2_BUCKET_NAME + "/" + key;
        return new Response(
          JSON.stringify({ uploadUrl: uploadUrl, publicUrl: publicUrl, key: key }),
          { headers: Object.assign({}, getCorsHeaders(origin), { "Content-Type": "application/json" }) }
        );
      });
    }).catch(function(err) {
      return new Response(
        JSON.stringify({ error: "Failed to generate signed URL" }),
        { status: 500, headers: Object.assign({}, getCorsHeaders(origin), { "Content-Type": "application/json" }) }
      );
    });
  }

  if (url.pathname === "/health") {
    return new Response("OK");
  }

  return new Response("Not found", { status: 404 });
}
