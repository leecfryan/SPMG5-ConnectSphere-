const internalRoles = new Set([
  "event_coordinator",
  "venue_staff",
  "technical_support_staff",
  "event_ops_manager",
]);
const externalRoles = new Set(["event_organiser", "attendee"]);

function requireAuth(authClient) {
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("Authorization") || "");
    if (!match)
      return res.status(401).json({ message: "Please sign in to continue." });

    try {
      // Verify with Supabase on every protected request. Never trust a decoded JWT or browser profile.
      const { data, error } = await authClient.auth.getUser(match[1]);
      if (error) {
        const unavailable =
          !error.status || error.status >= 500 || error.status === 429;
        return res.status(unavailable ? 503 : 401).json({
          message: unavailable
            ? "Unable to verify your session. Please try again."
            : "Your session has expired. Please sign in again.",
        });
      }
      if (!data?.user?.id)
        return res.status(401).json({ message: "Please sign in to continue." });
      const user = data.user;
      const rawRoles = user.app_metadata?.roles;
      const roles = Array.isArray(rawRoles)
        ? [
            ...new Set(
              rawRoles.filter(
                (role) => internalRoles.has(role) || externalRoles.has(role),
              ),
            ),
          ]
        : [];
      const accountTypes = [];
      if (roles.some((role) => internalRoles.has(role)))
        accountTypes.push("internal");
      if (roles.some((role) => externalRoles.has(role)))
        accountTypes.push("external");

      // Kept on the request for future role AND event-relationship authorisation.
      // Missing role metadata never defaults to a privileged role.
      req.user = {
        id: user.id,
        email: user.email,
        fullName:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : "",
        roles,
        accountTypes,
      };
      next();
    } catch {
      res
        .status(503)
        .json({ message: "Unable to verify your session. Please try again." });
    }
  };
}

module.exports = requireAuth;
