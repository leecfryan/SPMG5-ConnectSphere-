// Same pattern as requireDbRole.js, but admits either of two roles - needed
// because the clarification thread (Scrum-28-Scrum65/66) is readable and
// writable by both Technical Support Staff and the Event Coordinator, per
// AC4. Sets req.dbRole to whichever role matched, so the controller can
// apply the extra event-coordinator ownership check (AC4: the Coordinator
// only sees threads for events they coordinate; Technical Support has no
// such scoping) and stamp messages.author_role correctly - not for any
// audit purpose.
//
// If a caller holds both roles, req.dbRole resolves to "tech_support" - the
// broader of the two grants (no per-event ownership check) - rather than
// an arbitrary row order from the query.
function requireAnyDbRole(roles, client) {
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
        .in("role", roles);
      if (error) throw error;
      if (!data || data.length === 0) {
        return res
          .status(403)
          .json({ message: "You do not have permission to perform this action." });
      }
      const matched = data.map((row) => row.role);
      req.dbRole = matched.includes("tech_support") ? "tech_support" : matched[0];
      next();
    } catch {
      res.status(503).json({ message: "Unable to check access. Please try again." });
    }
  };
}

module.exports = requireAnyDbRole;
