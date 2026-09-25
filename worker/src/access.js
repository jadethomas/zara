/**
 * Cloudflare Access JWT verification.
 *
 * Access already gates zara-thomas.com/api/track at the edge, but this Worker
 * verifies the Cf-Access-Jwt-Assertion header itself on every private request
 * — defence in depth, and the only defence on any path Access does not cover
 * (a misconfigured route, a future workers.dev toggle, a request that reached
 * the Worker some other way).
 *
 * Verification: RS256 signature against the team's published JWKS, then
 * issuer, audience and time-window claims.
 */

// Per-isolate JWKS cache. This is a cache, not request state: it holds only
// Access's public keys, which are the same for every request. Refetched when
// a token arrives signed by a key we have not seen (rotation) — at most once
// per minute so a garbage kid cannot make us hammer the certs endpoint.
let jwks = { keys: new Map(), fetchedAt: 0 };

async function fetchKeys(teamDomain) {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const k of body.keys || []) keys.set(k.kid, k);
  jwks = { keys, fetchedAt: Date.now() };
}

function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeSegment(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/**
 * Verify the Access JWT on a request. Returns { email } on success,
 * throws on any failure — callers turn that into a 403.
 */
export async function requireAccess(request, env) {
  // Local development only: wrangler dev has no Access in front of it.
  // DEV_ALLOW_UNAUTHENTICATED comes from .dev.vars, which is gitignored and
  // must never appear in wrangler.jsonc vars.
  if (env.DEV_ALLOW_UNAUTHENTICATED === "1") return { email: "dev@localhost" };

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("no Access JWT on request");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const [h, p, sig] = parts;
  const header = decodeSegment(h);
  const payload = decodeSegment(p);
  if (header.alg !== "RS256") throw new Error(`unexpected alg ${header.alg}`);

  // Key lookup, refetching once if the kid is unknown (key rotation).
  if (!jwks.keys.has(header.kid) && Date.now() - jwks.fetchedAt > 60_000) {
    await fetchKeys(env.ACCESS_TEAM_DOMAIN);
  }
  const jwk = jwks.keys.get(header.kid);
  if (!jwk) throw new Error("JWT signed by unknown key");

  const key = await crypto.subtle.importKey(
    "jwk", jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error("JWT signature invalid");

  const now = Math.floor(Date.now() / 1000);
  const leeway = 60;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error("wrong issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error("wrong audience");
  if (typeof payload.exp !== "number" || payload.exp < now - leeway) throw new Error("JWT expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + leeway) throw new Error("JWT not yet valid");

  // A user identity token carries the email; a service token would not.
  // Everything here is human-driven, so require it.
  if (!payload.email) throw new Error("JWT has no email claim");
  return { email: payload.email };
}
