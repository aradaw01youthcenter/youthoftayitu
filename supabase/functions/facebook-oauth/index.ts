import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH";
const APP_ID = Deno.env.get("FACEBOOK_APP_ID")!;
const APP_SECRET = Deno.env.get("FACEBOOK_APP_SECRET")!;
const ENCRYPTION_KEY = Deno.env.get("FACEBOOK_TOKEN_ENCRYPTION_KEY")!;
const SITE_URL = "https://youthoftayitu.vercel.app";
const API_VERSION = "v26.0";
const FUNCTION_URL = PROJECT_URL + "/functions/v1/facebook-oauth";
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function base64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function encryptionKey() {
  const raw = base64ToBytes(ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("The Facebook token encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToBase64(combined);
}
async function decrypt(value: string) {
  const combined = base64ToBytes(value);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), ciphertext);
  return new TextDecoder().decode(plain);
}
function pageHtml(title: string, body: string) {
  const message = title + ": " + body.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").slice(0, 240);
  return Response.redirect(SITE_URL + "/admin/?facebook_notice=" + encodeURIComponent(message), 303);
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
async function graph(path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "Facebook returned an error.");
  return data;
}
async function getState(state: string) {
  const stateHash = await sha256(state);
  const { data, error } = await admin.rpc("facebook_oauth_state_get", { p_state_hash: stateHash });
  if (error) throw new Error("Could not verify the Facebook connection session.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) throw new Error("This Facebook connection request expired. Return to the admin dashboard and try again.");
  return { row, stateHash };
}
async function start(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Please sign in to the admin dashboard first." }, 401);
  const authResponse = await fetch(PROJECT_URL + "/auth/v1/user", {
    headers: { apikey: PUBLIC_KEY, Authorization: "Bearer " + token },
  });
  const authUser = await authResponse.json();
  if (!authResponse.ok || !authUser?.id) return json({ error: "Your admin session is invalid. Please sign in again." }, 401);

  const { data: role, error: roleError } = await admin.from("admin_users")
    .select("role").eq("user_id", authUser.id).maybeSingle();
  if (roleError) return json({ error: "Could not verify administrator permissions." }, 500);
  if (role?.role !== "owner") return json({ error: "Only the website owner can connect the Facebook Page." }, 403);

  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const stateHash = await sha256(state);
  const { error } = await admin.rpc("facebook_oauth_state_create", {
    p_state_hash: stateHash,
    p_user_id: authUser.id,
    p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  if (error) return json({ error: "Could not start the secure Facebook connection." }, 500);

  const redirectUri = FUNCTION_URL;
  const login = new URL(`https://www.facebook.com/${API_VERSION}/dialog/oauth`);
  login.searchParams.set("client_id", APP_ID);
  login.searchParams.set("redirect_uri", redirectUri);
  login.searchParams.set("response_type", "code");
  login.searchParams.set("state", state);
  login.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_manage_posts");
  return json({ url: login.toString(), redirect_uri: redirectUri });
}
async function callback(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (url.searchParams.has("error")) {
    return pageHtml("Facebook connection cancelled", `<p>${escapeHtml(url.searchParams.get("error_description") || "Facebook access was not granted.")}</p><p><a href="${SITE_URL}/admin/">Return to the admin dashboard</a></p>`);
  }
  if (!state || !code) return pageHtml("Unable to connect Facebook", "<p>The callback did not include the required authorization details. Return to the admin dashboard and try again.</p>");
  try {
    const { row, stateHash } = await getState(state);
    const shortToken = await graph("oauth/access_token", {
      client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: FUNCTION_URL, code,
    });
    let userToken = shortToken.access_token as string;
    try {
      const longToken = await graph("oauth/access_token", {
        client_id: APP_ID, client_secret: APP_SECRET, grant_type: "fb_exchange_token", fb_exchange_token: userToken,
      });
      if (longToken.access_token) userToken = longToken.access_token;
    } catch (e) {
      console.warn("Long-lived token exchange was not available; using the short-lived token for this connection attempt.");
    }
    const accounts = await graph("me/accounts", {
      fields: "id,name,access_token,tasks", limit: "100", access_token: userToken,
    });
    const pages = (accounts.data || []).map((p: any) => ({ id: String(p.id), name: String(p.name || "Facebook Page"), tasks: p.tasks || [] }));
    if (!pages.length) {
      await admin.rpc("facebook_oauth_state_delete", { p_state_hash: stateHash });
      return pageHtml("No Facebook Pages found", `<p>Facebook did not return any Pages that this account can manage. Check that you selected the correct Facebook account and granted <strong>pages_show_list</strong>.</p><p><a href="${SITE_URL}/admin/">Return to the admin dashboard</a></p>`);
    }
    const encryptedUserToken = await encrypt(userToken);
    const { error } = await admin.rpc("facebook_oauth_state_update", {
      p_state_hash: stateHash, p_encrypted_user_token: encryptedUserToken, p_available_pages: pages,
    });
    if (error) throw new Error("Could not save the temporary secure connection session.");
    const options = pages.map((p: any) => `<label><input type="radio" name="page_id" value="${escapeHtml(p.id)}" required> <strong>${escapeHtml(p.name)}</strong><br><span class="muted">Page ID: ${escapeHtml(p.id)}</span></label>`).join("");
    return Response.redirect(SITE_URL + "/admin/facebook-connect.html?state=" + encodeURIComponent(state), 303);
  } catch (e) {
    console.error("Facebook OAuth callback failed:", e);
    return pageHtml("Facebook connection failed", `<p>${escapeHtml((e as Error).message || "Please try again.")}</p><p><a href="${SITE_URL}/admin/">Return to the admin dashboard</a></p>`);
  }
}
async function ownerForRequest(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Please sign in to the admin dashboard again.");
  const authResponse = await fetch(PROJECT_URL + "/auth/v1/user", { headers: { apikey: PUBLIC_KEY, Authorization: "Bearer " + token } });
  const user = await authResponse.json();
  if (!authResponse.ok || !user?.id) throw new Error("Your admin session is invalid. Please sign in again.");
  const { data: role, error } = await admin.from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
  if (error || role?.role !== "owner") throw new Error("Only the website owner can manage the Facebook connection.");
  return user;
}
async function connectionStatus(req: Request) {
  try {
    await ownerForRequest(req);
    const { data, error } = await admin.rpc("facebook_connection_status");
    if (error) throw new Error("Could not read the saved Facebook Page connection.");
    return json(data || { connected: false });
  } catch (e) {
    return json({ error: (e as Error).message || "Could not check Facebook connection." }, 400);
  }
}
function collectFacebookImageUrls(post: any) {
  const attachmentUrls: string[] = [];
  const add = (target: string[], value: unknown) => {
    if (typeof value !== "string" || !value.startsWith("https://")) return false;
    try {
      const parsed = new URL(value);
      const host = parsed.hostname;
      if (!/(^|\.)fbcdn\.net$|(^|\.)facebook\.com$|(^|\.)fbsbx\.com$/i.test(host)) return false;
      // Facebook can return the same photo at different sizes, with different
      // query strings. The host + path identifies the underlying photo.
      const key = host.toLowerCase() + parsed.pathname;
      const alreadyAdded = target.some(existing => {
        try {
          const prior = new URL(existing);
          return prior.hostname.toLowerCase() + prior.pathname === key;
        } catch { return false; }
      });
      if (alreadyAdded) return false;
      target.push(value);
      return true;
    } catch { /* ignore malformed URLs */ return false; }
  };
  const walk = (items: any[]) => {
    for (const item of items || []) {
      // Prefer the photo rendition. "media.source" can be another rendition
      // of the same attachment, so use it only when no image URL is available.
      const addedImage = add(attachmentUrls, item?.media?.image?.src);
      if (!addedImage) add(attachmentUrls, item?.media?.source);
      if (Array.isArray(item?.subattachments?.data)) walk(item.subattachments.data);
    }
  };
  if (Array.isArray(post.attachments?.data)) walk(post.attachments.data);

  // Facebook's full_picture is the post preview and commonly repeats the
  // first photo in an album. Use it only for posts with no photo attachments.
  const urls = attachmentUrls.length ? attachmentUrls : [];
  if (!urls.length) add(urls, post.full_picture);
  return urls.slice(0, 10);
}
async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function storeFacebookImages(postId: string, urls: string[]) {
  const stored: string[] = [];
  const seenImageHashes = new Set<string>();
  const warnings: string[] = [];
  for (let i = 0; i < Math.min(urls.length, 10); i++) {
    try {
      const response = await fetch(urls[i]);
      if (!response.ok) throw new Error("Facebook image download failed.");
      const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) throw new Error("Facebook returned an unsupported image type.");
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 10 * 1024 * 1024) throw new Error("Image exceeds the 10 MB limit.");
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("Image is empty or exceeds the 10 MB limit.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const digest = await sha256Hex(bytes);
      // Different Facebook URLs can point to the exact same photo. Deduplicate by file content.
      if (seenImageHashes.has(digest)) continue;
      seenImageHashes.add(digest);
      const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
      const safePostId = postId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const path = "facebook-imports/" + safePostId + "/" + digest + "." + ext;
      const { error } = await admin.storage.from("post-images").upload(path, new Blob([bytes], { type: contentType }), {
        upsert: true, contentType, cacheControl: "31536000",
      });
      if (error) throw error;
      stored.push(admin.storage.from("post-images").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      warnings.push((e as Error).message || "One Facebook image could not be copied.");
    }
  }
  return { images: stored, warnings };
}
function facebookStoragePath(publicUrl: string) {
  try {
    const pathname = new URL(publicUrl).pathname;
    const marker = "/storage/v1/object/public/post-images/";
    const index = pathname.indexOf(marker);
    if (index < 0) return null;
    const path = decodeURIComponent(pathname.slice(index + marker.length));
    return path.startsWith("facebook-imports/") ? path : null;
  } catch { return null; }
}
async function removeUnusedFacebookImages(urls: string[]) {
  const paths = [...new Set(urls.map(facebookStoragePath).filter(Boolean))] as string[];
  if (paths.length) {
    const { error } = await admin.storage.from("post-images").remove(paths);
    if (error) console.warn("Some replaced Facebook images could not be cleaned up:", error.message);
  }
}
async function getFacebookPost(connection: any, pageToken: string, postId: string) {
  if (!postId.startsWith(String(connection.page_id) + "_")) throw new Error("This post does not belong to the connected Facebook Page.");
  return await graph(postId, {
    fields: "id,message,created_time,updated_time,permalink_url,full_picture,attachments{media_type,media,url,subattachments}",
    access_token: pageToken,
  });
}
function facebookPostTitle(message: string, createdTime: string | null) {
  const firstLine = message.split(/\r?\n/).map(v => v.trim()).find(Boolean) || "";
  if (firstLine) return firstLine.slice(0, 180);
  const date = createdTime ? new Date(createdTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return "Facebook update " + date;
}
function facebookSlug(title: string) {
  const base = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55) || "facebook-post";
  return base + "-" + Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 6);
}
async function importFacebookPost(req: Request, body: any) {
  try {
    await ownerForRequest(req);
    const { data: connection, error } = await admin.rpc("facebook_connection_feed_token");
    if (error || !connection?.connected || !connection?.encrypted_page_token) throw new Error("No Facebook Page is connected.");
    const pageToken = await decrypt(connection.encrypted_page_token);
    const postId = String(body.post_id || "");
    if (!postId) throw new Error("Choose a Facebook post to import.");
    const category = "Social Media Content";
    const existing = await admin.from("posts").select("id").eq("facebook_post_id", postId).maybeSingle();
    if (existing.error) throw new Error("Could not check whether this Facebook post was already imported.");
    if (existing.data) return json({ ok: true, already_imported: true, post_id: existing.data.id });
    const post = await getFacebookPost(connection, pageToken, postId);
    const message = String(post.message || "").trim();
    const imageResult = await storeFacebookImages(postId, collectFacebookImageUrls(post));
    const title = facebookPostTitle(message, post.created_time || null);
    const content = message || (imageResult.images.length ? "Photos from the Youth of Tayitu Facebook Page." : "Facebook post");
    const excerpt = content.slice(0, 180);
    const payload = {
      title, slug: facebookSlug(title), excerpt, content, category,
      status: "published", published_at: post.created_time || new Date().toISOString(),
      social_platform: "facebook", social_url: post.permalink_url || ("https://www.facebook.com/" + postId),
      images: [...new Set(imageResult.images)], cover_image: imageResult.images[0] || null,
      facebook_post_id: postId, facebook_source_message: message,
      facebook_images: [...new Set(imageResult.images)],
      facebook_source_updated_at: post.updated_time || post.created_time || null,
      facebook_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { data: saved, error: saveError } = await admin.from("posts").insert(payload).select("id,title,status").single();
    if (saveError) throw new Error(saveError.message || "Could not create the website draft.");
    return json({ ok: true, post: saved, image_count: imageResult.images.length, warnings: imageResult.warnings });
  } catch (e) {
    console.error("Facebook post import failed:", e);
    return json({ error: (e as Error).message || "Could not import Facebook post." }, 400);
  }
}
async function syncFacebookPosts(req: Request) {
  try {
    await ownerForRequest(req);
    const { data: connection, error } = await admin.rpc("facebook_connection_feed_token");
    if (error || !connection?.connected || !connection?.encrypted_page_token) throw new Error("No Facebook Page is connected.");
    const pageToken = await decrypt(connection.encrypted_page_token);
    const { data: posts, error: postsError } = await admin.from("posts").select("*").not("facebook_post_id", "is", null).limit(50);
    if (postsError) throw new Error("Could not load imported Facebook posts for synchronization.");
    let synced = 0, unchanged = 0;
    const failures: string[] = [];
    for (const saved of posts || []) {
      try {
        const latest = await getFacebookPost(connection, pageToken, saved.facebook_post_id);
        const sourceUpdated = latest.updated_time || latest.created_time || null;
        const oldFacebookImages = Array.isArray(saved.facebook_images) ? saved.facebook_images : [];
        const currentImages = Array.isArray(saved.images) ? saved.images : [];
        const uniqueOldFacebookImages = [...new Set(oldFacebookImages)];
        const retainedImages = currentImages.filter((url: string) => !oldFacebookImages.includes(url));
        const normalizedExistingImages = [...new Set(retainedImages.concat(uniqueOldFacebookImages))];
        const hasDuplicateImages = normalizedExistingImages.length !== currentImages.length ||
          uniqueOldFacebookImages.length !== oldFacebookImages.length;
        if (sourceUpdated && saved.facebook_source_updated_at && new Date(sourceUpdated).getTime() <= new Date(saved.facebook_source_updated_at).getTime()) {
          if (!hasDuplicateImages && saved.status === "published" && saved.category === "Social Media Content") {
            unchanged++;
            continue;
          }
          const { error: cleanupError } = await admin.from("posts").update({
            images: normalizedExistingImages,
            facebook_images: uniqueOldFacebookImages,
            category: "Social Media Content", status: "published",
            published_at: saved.published_at || sourceUpdated || new Date().toISOString(),
            cover_image: saved.cover_image || normalizedExistingImages[0] || null,
            updated_at: new Date().toISOString(),
          }).eq("id", saved.id);
          if (cleanupError) throw cleanupError;
          synced++;
          continue;
        }
        const sourceMessage = String(latest.message || "").trim();
        const nextContent = sourceMessage || "Facebook post";
        const imageResult = await storeFacebookImages(saved.facebook_post_id, collectFacebookImageUrls(latest));
        const mergedImages = retainedImages.concat(imageResult.images);
        const patch: any = {
          category: "Social Media Content", status: "published",
          published_at: saved.published_at || sourceUpdated || new Date().toISOString(),
          images: mergedImages,
          facebook_images: imageResult.images,
          cover_image: oldFacebookImages.includes(saved.cover_image) ? (imageResult.images[0] || retainedImages[0] || null) : (saved.cover_image || mergedImages[0] || null),
          social_url: latest.permalink_url || saved.social_url,
          facebook_source_message: sourceMessage,
          facebook_source_updated_at: sourceUpdated,
          facebook_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (saved.content === saved.facebook_source_message) {
          patch.content = nextContent;
          if (saved.excerpt === String(saved.facebook_source_message || "").slice(0, 180)) patch.excerpt = nextContent.slice(0, 180);
        }
        const { error: updateError } = await admin.from("posts").update(patch).eq("id", saved.id);
        if (updateError) throw updateError;
        await removeUnusedFacebookImages(oldFacebookImages.filter((url: string) => !imageResult.images.includes(url)));
        synced++;
      } catch (e) {
        failures.push(String(saved.title || saved.facebook_post_id) + ": " + ((e as Error).message || "sync failed"));
      }
    }
    return json({ ok: true, synced, unchanged, failed: failures.length, failures });
  } catch (e) {
    console.error("Facebook post sync failed:", e);
    return json({ error: (e as Error).message || "Could not synchronize Facebook posts." }, 400);
  }
}
async function pageFeed(req: Request) {
  try {
    await ownerForRequest(req);
    const { data: connection, error } = await admin.rpc("facebook_connection_feed_token");
    if (error) throw new Error("Could not read the saved Facebook Page connection.");
    if (!connection?.connected || !connection?.encrypted_page_token) return json({ error: "No Facebook Page is connected yet." }, 404);
    const pageToken = await decrypt(connection.encrypted_page_token);
    const feed = await graph(connection.page_id + "/posts", {
      fields: "id,message,created_time,updated_time,permalink_url,full_picture,attachments{media_type,media,url,subattachments}",
      limit: "12",
      access_token: pageToken,
    });
    const { data: importedRows } = await admin.from("posts").select("facebook_post_id").not("facebook_post_id", "is", null);
    const importedIds = new Set((importedRows || []).map((row: any) => row.facebook_post_id));
    const posts = (feed.data || []).map((p: any) => ({
      id: String(p.id || ""), message: String(p.message || ""),
      created_time: p.created_time || null, updated_time: p.updated_time || null,
      permalink_url: p.permalink_url || null,
      image_urls: collectFacebookImageUrls(p),
      imported: importedIds.has(String(p.id || "")),
    }));
    return json({ connected: true, page_id: connection.page_id, page_name: connection.page_name, posts });
  } catch (e) {
    console.error("Facebook feed request failed:", e);
    return json({ error: (e as Error).message || "Could not load Facebook feed." }, 400);
  }
}
async function listPages(req: Request, state: string) {
  try {
    const user = await ownerForRequest(req);
    const { row } = await getState(state);
    if (row.user_id !== user.id) return json({ error: "This Facebook connection belongs to a different admin session." }, 403);
    return json({ pages: row.available_pages || [] });
  } catch (e) {
    return json({ error: (e as Error).message || "Could not load Facebook Pages." }, 400);
  }
}
async function connectPage(req: Request, body?: any) {
  const form = body || Object.fromEntries(new URLSearchParams(await req.text()));
  const state = String(form.state || "");
  const pageId = String(form.page_id || "");
  if (!state || !pageId) return pageHtml("Unable to connect Page", "<p>The Page selection was incomplete. Please start again from the dashboard.</p>");
  try {
    const user = await ownerForRequest(req);
    const { row, stateHash } = await getState(state);
    if (row.user_id !== user.id) throw new Error("This Facebook connection belongs to a different admin session.");
    if (!row.encrypted_user_token) throw new Error("The Facebook session is incomplete. Please start again.");
    const userToken = await decrypt(row.encrypted_user_token);
    const accounts = await graph("me/accounts", {
      fields: "id,name,access_token,tasks", limit: "100", access_token: userToken,
    });
    const page = (accounts.data || []).find((p: any) => String(p.id) === pageId);
    if (!page?.access_token) throw new Error("Facebook did not provide access to the selected Page.");
    const encryptedPageToken = await encrypt(page.access_token);
    const { error: saveError } = await admin.rpc("facebook_connection_save", {
      p_page_id: String(page.id), p_page_name: String(page.name || "Facebook Page"),
      p_encrypted_page_token: encryptedPageToken, p_connected_by: row.user_id,
    });
    if (saveError) throw new Error("The Page token could not be stored securely.");
    await admin.rpc("facebook_oauth_state_delete", { p_state_hash: stateHash });
    return body ? json({ ok: true, connected: true }) : Response.redirect(SITE_URL + "/admin/?facebook_connected=1", 303);
  } catch (e) {
    console.error("Facebook Page selection failed:", e);
    return body ? json({ error: (e as Error).message || "Could not connect Facebook Page." }, 400) : pageHtml("Could not connect Facebook Page", `<p>${escapeHtml((e as Error).message || "Please try again.")}</p><p><a href="${SITE_URL}/admin/">Return to the admin dashboard</a></p>`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!APP_ID || !APP_SECRET || !ENCRYPTION_KEY || !SERVICE_KEY) return json({ error: "Facebook server configuration is incomplete." }, 500);
  if (req.method === "GET") return callback(req);
  if (req.method === "POST" && req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return connectPage(req);
  if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = await req.json();
      if (body.action === "start") return await start(req);
      if (body.action === "status") return await connectionStatus(req);
      if (body.action === "feed") return await pageFeed(req);
      if (body.action === "import") return await importFacebookPost(req, body);
      if (body.action === "sync") return await syncFacebookPosts(req);
      if (body.action === "pages") return await listPages(req, String(body.state || ""));
      if (body.action === "connect") return await connectPage(req, body);
      return json({ error: "Unsupported action." }, 400);
    } catch (e) {
      console.error("Facebook connection start failed:", e);
      return json({ error: "Could not start Facebook connection. Please try again." }, 500);
    }
  }
  return json({ error: "Method not allowed." }, 405);
});
