# Dosre account ke liye ready-to-paste message (Tokisla)

Assalam-o-Alaikum. Ye **Tokisla** project ki mukammal, test-shuda files hain (Islamic-friendly short-video app — TikTok-style feed, max 20 second videos, human moderation ke baghair koi video public nahi hoti). Tumhara kaam sirf **connection** hai — kuch dobara banana ya redesign NAHI karna, credits bachane hain.

Files ke saath `SETUP_GUIDE.md` hai — bilkul usi ke steps follow karne hain:

1. GitHub par private repo `tokisla` bana kar saari files upload karo, Pages on karo.
2. Supabase free project banao; pehle `supabase/migrations/0001_init.sql`, phir `0002_rls.sql`, phir `0003_features.sql` chalao. Buckets migrations khud bana dengi.
3. Edge Functions deploy karo: `create-upload` aur `delete-account`. Service-role key sirf wahan lagegi — kisi file mein kabhi nahi likhni.
4. Owner ko pehle app mein signup karwa kar SQL se us ka role `admin` set karo (guide Step 4 mein query di hai).
5. `config.js` mein sirf Supabase URL + anon key bharo — app live database se jud jayegi.
6. Guide ke Step 6 ki live test checklist mukammal kar ke report do (khaas taur par: pending video feed mein na aaye, 25 second wali video reject ho, RLS probe pass ho).

Ahem hidayat:
- Ye vanilla HTML/CSS/JS hai — Flutter ya koi framework NAHI lagana.
- Kuch bhi khareedna ya paid plan on NAHI karna.
- Agar koi SQL statement pehli dafa error de to sirf wahi theek karna hai, schema redesign nahi karna.
- Play Store (Capacitor wrap + AAB) guide ke Step 7 mein hai — woh is connection ke baad ki marhala hai, owner ke kehne par hi karna.

Is build mein ye sab shaamil hai: guest-first feed, bottom nav (Home / Friends / + / Alerts / Profile), Discover page par categories aur trending hashtags, tappable #hashtags aur @mentions (caption par bhi mention notification jati hai), comment likes aur creator ki pin ki hui comment, direct messages (Alerts ke upar Messages), blue-tick applications (Rs 300/month — admin Users tab se approve hoti hain), profile link, Light/Dark aur Urdu mode, naya dark + gradient theme (logo wale rang), profile photo par + se seedha gallery picker, upload filters (Normal/Warm/Cool/Mono/Vivid), video par poll, drafts (pehle save, baad mein post), kisi comment ka jawab video se, Duet (side-by-side video), watermark ke sath download, aur Stories (24 ghante, pehle admin approve kare — admin panel mein alag Stories tab hai). Demo mode mein sab kuch test ho chuka hai (234 checks pass). Shukriya!
