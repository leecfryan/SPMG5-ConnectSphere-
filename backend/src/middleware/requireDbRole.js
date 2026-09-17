// A simple role check against the public.user_roles table (user_id, role) -
// the trusted role source for the equipment request story, per its RLS
// policies. This is deliberately not a policy/permission framework like
// auth/permissions.js + requirePermission.js: one membership check, nothing
// else. Backend queries use the service-role client, which bypasses RLS, so
// this check is what actually protects these routes (see docs/staff-access.md
// "Trusted role source and database access").
//
// `client` is an explicit parameter, not a top-level `require("../supabase")`
// - the real client is only ever wired in by equipment.routes.js. That keeps
// this file free of any Supabase import, so its tests run without
// SUPABASE_URL / SUPABASE_SECRET_KEY set and without touching the live
// database, the same reasoning events.validation.js documents for avoiding
// events.repository.js.
function requireDbRole(role, client) {
  return async function (req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!req.user?.id) {
      return res.status(401).json({ message: "Please sign in to continue." });
    }
    try {
      const { data, error } = await client
        .from("user_roles")
        .select("role")
        .eq("user_id", req.user.id)
        .eq("role", role)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res
          .status(403)
          .json({ message: "You do not have permission to perform this action." });
      }
      next();
    } catch {
      res.status(503).json({ message: "Unable to check access. Please try again." });
    }
  };
}

module.exports = requireDbRole;
