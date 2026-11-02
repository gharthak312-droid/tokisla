// Tokisla — configuration.
// Empty keys = DEMO MODE (local sample data, everything testable, clearly badged).
// The second account fills these two values at connection time (SETUP_GUIDE.md).
// The anon key is safe to ship in the app; the service-role key must NEVER be here.
window.TOKISLA_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  // Upload rules (also enforced again on the backend — see supabase/migrations).
  MAX_VIDEO_SECONDS: 20,
  MAX_VIDEO_MB: 15,
  APP_NAME: "Tokisla",
};
