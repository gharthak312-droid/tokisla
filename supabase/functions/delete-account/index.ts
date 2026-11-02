// Tokisla — delete-account Edge Function (Deno, deploy on Supabase).
// Play Store requirement: users can delete their account in-app.
// Verifies the caller's JWT, removes their storage objects, then deletes
// the auth user (profile + content cascade via foreign keys).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
    }
    const userId = userData.user.id;

    const { data: vids } = await admin.from("videos")
      .select("storage_path, thumbnail_path").eq("creator_id", userId);
    const paths = (vids || []).flatMap((v) => [v.storage_path, v.thumbnail_path]).filter(Boolean);
    if (paths.length) await admin.storage.from("videos").remove(paths as string[]);

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
