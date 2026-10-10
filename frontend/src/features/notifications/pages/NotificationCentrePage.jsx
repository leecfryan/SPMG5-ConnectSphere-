import { Inbox } from "@novu/react";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import NotificationInbox from "../components/NotificationInbox";

const appearance = {
  variables: { colorPrimary: "#185c4b" },
  elements: { inboxContent: { width: "100%", maxWidth: "100%", fontFamily: "Segoe UI, Arial, sans-serif" } },
};

export default function NotificationCentrePage() {
  const { user, token } = useAuth();
  const { data, error, loading, reload } = useApiResource("/api/notifications/inbox-config");
  return (
    <section className="card" aria-labelledby="notifications-title">
      <h1 id="notifications-title">Notifications</h1>
      {loading ? <p role="status">Loading your notifications…</p> :
        error || data.subscriberId !== user.id ? <>
          <p className="error" role="alert">Your notifications could not be loaded. Please try again.</p>
          <button className="secondary" onClick={reload}>Retry notifications</button>
        </> : <Inbox
          key={user.id + ":" + token}
          applicationIdentifier={data.applicationIdentifier}
          subscriber={data.subscriberId}
          subscriberHash={data.subscriberHash}
          appearance={appearance}
          localization={{ "notifications.emptyNotice": "You have no notifications yet." }}
        >
          <NotificationInbox reload={reload} />
        </Inbox>}
    </section>
  );
}
