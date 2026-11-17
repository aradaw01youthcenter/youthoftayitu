import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH";
const SITE_URL = "https://youthoftayitu.vercel.app";
const cors = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const admin = createClient(PROJECT_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function publicHttpUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid website URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS websites are supported.");
  if (url.username || url.password) throw new Error("Website URLs must not contain embedded credentials.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Custom ports are not supported.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private or local network addresses are not allowed.");
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) {
    const p = host.split(".").map(Number);
    if (host.includes(":") || p.length !== 4 || p.some(n => n > 255) ||
      p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] >= 224 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254)) {
      throw new Error("Private or local network addresses are not allowed.");
    }
    throw new Error("Use the website's domain name instead of an IP address.");
  }
  return url;
}
function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}
function isPrivateIpv6(address: string) {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (mapped.includes(".")) return isPrivateIpv4(mapped);
    const groups = mapped.split(":");
    if (groups.length >= 2) {
      const hi = parseInt(groups[groups.length - 2], 16);
      const lo = parseInt(groups[groups.length - 1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
      }
    }
    return true;
  }
  const first = parseInt(value.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;
  return first < 0x2000 || first > 0x3fff ||
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    (first >= 0xff00 && first <= 0xffff) ||
    value.startsWith("2001:db8:") ||
    value.startsWith("2001:0:") ||
    value.startsWith("2001:20:") ||
    value.startsWith("2002:") ||
    value.startsWith("3fff:");
}
async function assertPublicDns(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
  const [a, aaaa] = await Promise.allSettled([
    Deno.resolveDns(host, "A"),
    Deno.resolveDns(host, "AAAA"),
  ]);
  const addresses = [
    ...(a.status === "fulfilled" ? a.value : []),
    ...(aaaa.status === "fulfilled" ? aaaa.value : []),
  ];
  if (!addresses.length) throw new Error("The website domain could not be verified as publicly reachable.");
  if (addresses.some(address => address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address))) {
    throw new Error("This website resolves to a private or reserved network address and cannot be previewed.");
  }
}
function decodeEntities(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function attrs(tag: string) {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) out[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return out;
}
function absoluteImage(raw: string | undefined, base: URL) {
  if (!raw) return null;
  try {
    const u = publicHttpUrl(new URL(raw, base).toString());
    return u.toString();
  } catch { return null; }
}
async function readLimited(response: Response, limit = 900_000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const all = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, all.length - offset);
    if (take <= 0) break;
    all.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}
async function inspectWebsite(raw: string) {
  let current = publicHttpUrl(raw);
  let response: Response | null = null;
  for (let hop = 0; hop <= 3; hop++) {
    // Check every hostname, including redirect destinations, before making an outbound request.
    // DNS checks reduce SSRF exposure; strict DNS-rebinding prevention requires controlled egress.
    await assertPublicDns(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "YouthOfTayituPortalPreview/1.0 (+https://youthoftayitu.vercel.app)", "Accept": "text/html,application/xhtml+xml" },
      });
    } finally { clearTimeout(timeout); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 3) break;
      current = publicHttpUrl(new URL(location, current).toString());
      continue;
    }
    break;
  }
  if (!response) throw new Error("The website did not return a response.");
  const status = response.status;
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("html")) {
    return { http_status: status, final_url: current.toString(), title: null, description: null, preview_image: null, image_source: null, note: "The website responded, but did not return an HTML page with preview metadata." };
  }
  const html = await readLimited(response);
  const metas: Record<string, string> = {};
  let icon: string | null = null;
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !metas[key]) metas[key] = a.content.trim();
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(a.rel || "") && a.href) {
      icon = absoluteImage(a.href, current);
      if (icon) break;
    }
  }
  const title = metas["og:title"] || (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim() || null;
  const description = metas["og:description"] || metas.description || metas["twitter:description"] || null;
  const og = absoluteImage(metas["og:image"] || metas["og:image:secure_url"], current);
  const tw = absoluteImage(metas["twitter:image"] || metas["twitter:image:src"], current);
  const image = og || tw || icon || absoluteImage("/favicon.ico", current);
  return {
    http_status: status,
    final_url: current.toString(),
    title: title ? decodeEntities(title).slice(0, 180) : null,
    description: description ? decodeEntities(description).slice(0, 400) : null,
    preview_image: image,
    image_source: og ? "og:image" : tw ? "twitter:image" : icon ? "favicon" : image ? "default-favicon" : null,
    note: image ? null : "No social preview image or favicon was found. You can upload an image manually.",
  };
}
async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Please sign in to the admin dashboard first.");
  const authResponse = await fetch(PROJECT_URL + "/auth/v1/user", {
    headers: { apikey: PUBLIC_KEY, Authorization: "Bearer " + token },
  });
  const user = await authResponse.json();
  if (!authResponse.ok || !user?.id) throw new Error("Your admin session is invalid. Please sign in again.");
  const { data: role, error } = await admin.from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
  if (error || !role) throw new Error("Administrator permissions could not be verified.");
  return user;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    if (!["preview", "check"].includes(body.action)) return json({ error: "Unsupported portal action." }, 400);
    if (typeof body.url !== "string" || body.url.length > 2048) return json({ error: "A valid website URL is required." }, 400);
    const result = await inspectWebsite(body.url);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The portal request failed.";
    const status = /sign in|session|permissions|administrator/i.test(message) ? 401 : 400;
    return json({ error: message }, status);
  }
});