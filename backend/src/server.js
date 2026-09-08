const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { createClient } = require("@supabase/supabase-js");
const createApp = require("./app");

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !publishableKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the root .env.");
}
// User verification uses the public key, separate from the seed script's admin client.
const authClient = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const app = createApp({
  authClient, supabaseUrl, publishableKey,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
});
const port = process.env.PORT || 3000;
app.listen(port, (error) => {
  if (error) {
    console.error("Unable to start server on port " + port + ": " + error.code);
    process.exitCode = 1;
    return;
  }
  console.log("Server is running on port " + port);
});
