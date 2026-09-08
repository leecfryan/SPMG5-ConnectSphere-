require("dotenv").config();

const supabase = require("./supabase");

async function checkSupabase() {
  const { error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });

  if (error) {
    console.error("Error checking Supabase connection:", error);
    process.exit(1);
  }

  console.log("Supabase connection is healthy");
}

checkSupabase();
