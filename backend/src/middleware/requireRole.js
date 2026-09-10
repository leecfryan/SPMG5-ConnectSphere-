function requireRole(...allowedRoles) {
  return function (req, res, next) {
    const role = req.header("x-user-role");

    if (!role) {
      return res.status(401).json({ error: "Missing role" });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    req.userRole = role;
    next();
  };
}

module.exports = requireRole;