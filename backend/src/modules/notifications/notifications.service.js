const { createHmac } = require("node:crypto");

function createNotificationsService({ applicationIdentifier, secretKey }) {
  applicationIdentifier = applicationIdentifier?.trim();
  if (!applicationIdentifier || !secretKey?.trim()) return undefined;

  return {
    inboxConfig(userId) {
      return {
        applicationIdentifier,
        subscriberId: userId,
        subscriberHash: createHmac("sha256", secretKey).update(userId).digest("hex"),
      };
    },
  };
}

module.exports = { createNotificationsService };
