// Tokisla — configuration.
// Empty project ID = DEMO MODE (local sample data, everything testable, clearly badged).
// Live mode needs only the public Appwrite endpoint + project ID, both safe
// to ship in the app. There is NO secret key in this file: API keys bypass
// permissions and live only as Appwrite Function variables, server-side.
// See APPWRITE_SETUP.md for the live setup truth; docs/ keeps the history.
window.TOKISLA_CONFIG = {
  APPWRITE_ENDPOINT: "https://sgp.cloud.appwrite.io/v1",
  APPWRITE_PROJECT_ID: "6ae910e6000dad2f34b4",
  // Upload rules (also enforced again on the backend — see APPWRITE_SETUP.md).
  MAX_VIDEO_SECONDS: 20,
  MAX_VIDEO_MB: 15,
  APP_NAME: "Tokisla",
};
