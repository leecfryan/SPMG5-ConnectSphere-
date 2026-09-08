const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const supabase = require("../src/supabase");

const SEED_ID = "connectsphere-sprint1";
const users = [
  { email: "coordinator.demo@example.com", name: "Demo Coordinator", role: "event_coordinator", type: "internal" },
  { email: "venue.demo@example.com", name: "Demo Venue Staff", role: "venue_staff", type: "internal" },
  { email: "technical.demo@example.com", name: "Demo Technical Staff", role: "technical_support_staff", type: "internal" },
  { email: "organiser.demo@example.com", name: "Demo Event Organiser", role: "event_organiser", type: "external" },
  { email: "attendee1.demo@example.com", name: "Demo Attendee One", role: "attendee", type: "external" },
  { email: "attendee2.demo@example.com", name: "Demo Attendee Two", role: "attendee", type: "external" },
  { email: "attendee3.demo@example.com", name: "Demo Attendee Three", role: "attendee", type: "external" },
];

async function seedUsers() {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error("Set SEED_USER_PASSWORD to at least 16 characters in the root .env.");
  }

  const existing = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    for (const user of data.users) existing.set(user.email?.toLowerCase(), user);
    if (data.users.length < 100) break;
  }

  // Check all collisions before creating anything. Never adopt or overwrite an unrelated account.
  for (const user of users) {
    const account = existing.get(user.email);
    if (account && (
      account.app_metadata.seed_id !== SEED_ID ||
      JSON.stringify(account.app_metadata.roles) !== JSON.stringify([user.role]) ||
      account.app_metadata.user_type !== user.type ||
      !account.email_confirmed_at
    )) {
      throw new Error("Existing account differs from this seed: " + user.email + ". Review it manually.");
    }
  }

  let created = 0;
  for (const user of users) {
    if (existing.has(user.email)) {
      console.log("Already seeded: " + user.email + " (" + user.role + ")");
      continue;
    }
    // Admin creation confirms these example.com accounts without sending email.
    // Authorisation must later enforce these admin-controlled roles; metadata alone does not grant access.
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      app_metadata: { seed_id: SEED_ID, roles: [user.role], user_type: user.type },
      user_metadata: { full_name: user.name },
    });
    if (error) throw new Error("Could not create " + user.email + ": " + error.message);

    const { data: saved, error: readError } = await supabase.auth.admin.getUserById(data.user.id);
    if (readError) throw readError;
    if (!saved.user.email_confirmed_at ||
        saved.user.app_metadata.seed_id !== SEED_ID ||
        saved.user.app_metadata.roles?.[0] !== user.role ||
        saved.user.app_metadata.user_type !== user.type) {
      throw new Error("Verification failed for " + user.email);
    }
    created += 1;
    console.log("Created and verified: " + user.email + " (" + user.role + ")");
  }
  console.log("Done: " + created + " created; " + (users.length - created) + " already seeded.");
}

seedUsers().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
