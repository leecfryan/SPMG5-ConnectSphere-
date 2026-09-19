const path = require("node:path");
const Module = require("node:module");

const SUPABASE_PATH = path.resolve(__dirname, "../../src/supabase.js");

function stubSupabase(fake = {}) {
  const stub = new Module(SUPABASE_PATH);
  stub.filename = SUPABASE_PATH;
  stub.loaded = true;
  stub.exports = fake;
  require.cache[SUPABASE_PATH] = stub;
  return fake;
}

module.exports = { stubSupabase };
