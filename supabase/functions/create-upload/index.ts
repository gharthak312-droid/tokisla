// Tokisla — create-upload Edge Function (Deno, deploy on Supabase).
// Runs with the SERVICE ROLE key server-side only. The app never holds it.
//
// Contract (called by store.js submitVideo in live mode):
//   POST { caption, category_ids, visibility, duration_seconds, size_bytes,
//          filename, content_type, thumbnail_path?,
//          filter?, poll?, duet_of?, reply_comment_id?, is_draft? }
//   ->  { video, upload_url }   (client PUTs the file bytes to upload_url)
//
// Server-side enforcement (never trust the client alone):
//   * caller must be a signed-in, non-suspended user (JWT verified here)
//   * duration must be <= 20.5s and size <= 25 MB, or the request is refused
//   * the row is created with moderation_status = 'pending' — the client
//     cannot choose its own status (RLS + this function agree on that).
//     The one exception is is_draft: a draft is LESS visible than pending
//     (owner-only, in no queue), so a client may ask for it safely.
// NOTE: duration/size arrive from the client's media probe. They are
// re-checked here and capped in the database, but a determined attacker
// could lie about a probe value. Strict server-side media probing
// (e.g. an ffprobe worker) is the documented upgrade step in SETUP_GUIDE.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_SECONDS = 20.5;
const MAX_BYTES = 25 * 1024 * 1024;

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
    if (userErr || !userData.user) return json({ error: "Not signed in." }, 401);
    const user = userData.user;

    const { data: profile } = await admin.from("profiles")
      .select("is_suspended").eq("id", user.id).single();
    if (!profile || profile.is_suspended) return json({ error: "Account not allowed to upload." }, 403);

    const body = await req.json();
    const duration = Number(body.duration_seconds);
    const size = Number(body.size_bytes || 0);
    if (!(duration > 0) || duration > MAX_SECONDS)
      return json({ error: `Videos must be ${MAX_SECONDS - 0.5} seconds or shorter.` }, 400);
    if (size > MAX_BYTES) return json({ error: "Video file is too large." }, 400);

    // Optional feature fields (0003): validated/sanitised here, never trusted raw.
    const FILTERS = ["normal", "warm", "cool", "mono", "vivid"];
    const filter = FILTERS.includes(body.filter) ? body.filter : "normal";
    let poll = null;
    if (body.poll && typeof body.poll === "object") {
      const q = String(body.poll.question || "").slice(0, 80).trim();
      const opts = Array.isArray(body.poll.options) ? body.poll.options : [];
      const o1 = String(opts[0] || "").slice(0, 30).trim();
      const o2 = String(opts[1] || "").slice(0, 30).trim();
      if (q && o1 && o2) poll = { question: q, options: [o1, o2] };
    }
    const duetOf = typeof body.duet_of === "string" ? body.duet_of : null;
    let replyCommentId = null, replyVideoId = null;
    if (typeof body.reply_comment_id === "string") {
      const { data: rc } = await admin.from("comments")
        .select("id, video_id").eq("id", body.reply_comment_id).maybeSingle();
      if (rc) { replyCommentId = rc.id; replyVideoId = rc.video_id; }
    }
    const isDraft = body.is_draft === true;

    const videoId = crypto.randomUUID();
    const ext = (body.filename || "video.mp4").split(".").pop()?.toLowerCase() || "mp4";
    const path = `${user.id}/${videoId}.${ext}`;

    const { data: video, error: insErr } = await admin.from("videos").insert({
      id: videoId,
      creator_id: user.id,
      caption: String(body.caption || "").slice(0, 300),
      storage_provider: "supabase",
      storage_path: path,
      thumbnail_path: body.thumbnail_path || null,
      duration_seconds: duration,
      size_bytes: size || null,
      visibility: ["public", "followers", "private"].includes(body.visibility) ? body.visibility : "public",
      moderation_status: isDraft ? "draft" : "pending",
      filter, poll, duet_of: duetOf,
      reply_comment_id: replyCommentId, reply_video_id: replyVideoId,
    }).select().single();
    if (insErr) return json({ error: insErr.message }, 400);

    const cats = Array.isArray(body.category_ids) ? body.category_ids.slice(0, 3) : [];
    if (cats.length) {
      await admin.from("video_categories").insert(
        cats.map((category_id: number) => ({ video_id: videoId, category_id })),
      );
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("videos").createSignedUploadUrl(path);
    if (signErr) return json({ error: signErr.message }, 500);

    await admin.from("moderation_events").insert({
      video_id: videoId, event_type: "uploaded",
      details: { duration_seconds: duration, size_bytes: size },
    });

    // Caption @mentions (best-effort; drafts notify when published, from the app).
    if (!isDraft) {
      try {
        const names = [...new Set((String(body.caption || "").match(/@([a-z0-9_.]+)/gi) || [])
          .map((x) => x.slice(1).toLowerCase()))];
        for (const name of names) {
          const { data: target } = await admin.from("profiles")
            .select("id").eq("username", name).maybeSingle();
          if (!target || target.id === user.id) continue;
          await admin.from("notifications").insert({
            user_id: target.id, type: "mention", actor_id: user.id, video_id: videoId,
          });
        }
      } catch (_e) { /* mentions never block an upload */ }
    }

    return json({ video, upload_url: signed.signedUrl }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json" },
  });
}
