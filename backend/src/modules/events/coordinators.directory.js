const COORDINATOR_ROLE = "event_coordinator";

const PER_PAGE = 100;
const MAX_PAGES = 20;

function displayName(user) {
  const name = user.user_metadata?.full_name;
  return typeof name === "string" && name.trim() ? name.trim() : "";
}

module.exports = function createCoordinatorDirectory(client = require("../../supabase")) {
  async function listCoordinators() {
    const coordinators = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) {
        throw new Error(`coordinators.directory: listUsers failed - ${error.message}`);
      }
      const users = data?.users ?? [];
      for (const user of users) {
        const roles = user.app_metadata?.roles;
        if (Array.isArray(roles) && roles.includes(COORDINATOR_ROLE)) {
          coordinators.push({ id: user.id, fullName: displayName(user), email: user.email ?? "" });
        }
      }
      if (users.length < PER_PAGE) break;
    }
    return coordinators.sort((a, b) =>
      (a.fullName || a.email).localeCompare(b.fullName || b.email));
  }

  return { listCoordinators };
};
