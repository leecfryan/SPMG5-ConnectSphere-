function createNotificationsController(service) {
  return {
    inboxConfig(req, res) {
      if (!service) {
        return res.status(503).json({ message: "Notifications are not configured yet. Please try again later." });
      }
      // SCRUM-143 AC3: sign only the verified caller; request fields cannot select another inbox.
      return res.json(service.inboxConfig(req.user.id));
    },
  };
}

module.exports = createNotificationsController;
