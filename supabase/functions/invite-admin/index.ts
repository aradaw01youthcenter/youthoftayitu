import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://youthoftayitu.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return respond({ error: "Server admin credentials are not configured." }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Please sign in first." }, 401);

  // Validate the browser's access token directly with Supabase Auth.
  // Keep the service-role client separate; it is used only after caller identity is verified.
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH";
  let callerUser: { id: string; email?: string };
  try {
    const authResponse = await fetch(url + "/auth/v1/user", {
      method: "GET",
      headers: { apikey: publicKey, Authorization: "Bearer " + token },
    });
    const authPayload = await authResponse.json();
    if (!authResponse.ok || !authPayload?.id) {
      const authReason = String(authPayload?.message || authPayload?.msg || authPayload?.error_description || authPayload?.error || "No error detail returned");
      console.error("invite-admin token rejected:", authResponse.status, authReason, authPayload?.code || "");
      return respond({ error: "Supabase Auth rejected the session (HTTP " + authResponse.status + "): " + authReason }, 401);
    }
    callerUser = { id: authPayload.id, email: authPayload.email };
  } catch (authFailure) {
    console.error("invite-admin auth verification request failed:", authFailure);
    return respond({ error: "Could not verify your sign-in with Supabase Auth. Please retry." }, 502);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data: callerRole, error: roleLookupError } = await admin.from("admin_users")
    .select("role").eq("user_id", callerUser.id).maybeSingle();
  if (roleLookupError) return respond({ error: "Could not verify administrator permissions." }, 500);
  if (callerRole?.role !== "owner") return respond({ error: "Only the website owner can manage administrators." }, 403);

  let body: { email?: string; password?: string; action?: string };
  try { body = await req.json(); } catch { return respond({ error: "Invalid request." }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const action = String(body.action || "create");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter a valid email address." }, 400);
  if (email === "aradaw01youthcenter@gmail.com") return respond({ error: "The website owner account cannot be changed or removed." }, 400);

  const recordActivity = async (event: string, targetEmail: string) => {
    const { error } = await admin.from("admin_activity_logs").insert({
      actor_user_id: callerUser.id,
      actor_email: callerUser.email || "",
      action: event,
      target_type: "administrator",
      target_label: targetEmail,
      details: { target_email: targetEmail },
    });
    if (error) console.error("Activity log insert failed:", error.message);
  };

  if (action === "remove" || action === "cancel") {
    const { data: target, error: lookupError } = await admin.from("admin_users")
      .select("user_id,email,role").eq("email", email).maybeSingle();
    if (lookupError) return respond({ error: lookupError.message }, 500);
    if (!target || target.role !== "admin") return respond({ error: "That administrator was not found or cannot be removed." }, 404);

    // Remove the role first so any still-valid JWT immediately loses dashboard permissions.
    const { error: rowError } = await admin.from("admin_users").delete().eq("user_id", target.user_id);
    if (rowError) return respond({ error: "Could not revoke administrator permissions: " + rowError.message }, 500);

    // Deleting the Auth user revokes their account and sessions. Do not call admin.signOut
    // with user_id: that method expects a JWT, not a user UUID.
    const { error: deleteError } = await admin.auth.admin.deleteUser(target.user_id);
    if (deleteError) {
      const { error: restoreError } = await admin.from("admin_users").insert({
        user_id: target.user_id,
        email: target.email,
        role: target.role,
      });
      if (restoreError) {
        return respond({ error: "Auth account deletion failed (" + deleteError.message + ") and administrator access could not be restored (" + restoreError.message + "). Contact support immediately." }, 500);
      }
      return respond({ error: "Could not delete the administrator's login account: " + deleteError.message + ". Their administrator role has been restored." }, 400);
    }
    await recordActivity("Removed administrator access", email);
    return respond({ ok: true, email, message: "Administrator account and access removed." });
  }

  if (action !== "create") return respond({ error: "Unsupported action." }, 400);
  const password = String(body.password || "");
  if (password.length < 8) return respond({ error: "Set a password with at least 8 characters." }, 400);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) return respond({ error: createError.message }, 400);
  if (!created.user) return respond({ error: "The account could not be created." }, 500);

  const { error: saveRoleError } = await admin.from("admin_users").insert({
    user_id: created.user.id,
    email,
    role: "admin",
  });
  if (saveRoleError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return respond({ error: "The account could not be registered as an administrator. No account was kept. " + saveRoleError.message }, 500);
  }

  await recordActivity("Created administrator account", email);
  return respond({ ok: true, email, message: "Administrator account created and access granted. Share the login details with the administrator through a secure channel." });
});