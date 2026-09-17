const { getPolicy, hasPermission } = require("../auth/permissions");

function requirePermission(permission, authorizeRecord) {
  const policy = getPolicy(permission);
  if (!policy) throw new TypeError("Unknown permission: " + permission);
  if (policy.record && typeof authorizeRecord !== "function") {
    throw new TypeError(permission + " requires a server-side record access check.");
  }

  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.user?.id) return res.status(401).json({ message: "Please sign in to continue." });
    // Only use req.user after requireAuth has verified it. Never read roles from request input.
    if (!hasPermission(req.user.roles, permission) ||
        (permission.endsWith(".read") && !["GET", "HEAD"].includes(req.method))) {
      return res.status(403).json({ message: "You do not have permission to access this information." });
    }
    if (authorizeRecord) {
      try {
        // Require an explicit boolean true. Missing records and unresolved checks deny access.
        if (await authorizeRecord(req) !== true) {
          // A record-scoped denial can safely explain *why* (e.g. "not your
          // event") without leaking anything - it's the same rule for every
          // holder of this role, not information about a specific record.
          // The role-check denial above stays generic: which permission a
          // user lacks is not something to spell out.
          return res.status(403).json({
            message:
              policy.recordDeniedMessage ||
              "You do not have permission to access this information.",
            ...(policy.recordDeniedCode ? { code: policy.recordDeniedCode } : {}),
          });
        }
      } catch {
        return res.status(503).json({ message: "Unable to check access. Please try again." });
      }
    }
    next();
  };
}

module.exports = requirePermission;
