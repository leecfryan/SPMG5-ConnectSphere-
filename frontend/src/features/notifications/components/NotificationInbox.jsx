import { useEffect, useState } from "react";
import { InboxContent, useNovu } from "@novu/react";
import { useCounts, useNotifications } from "@novu/react/hooks";
import NotificationReadButton from "./NotificationReadButton";

export default function NotificationInbox({ reload }) {
  const novu = useNovu();
  const [readError, setReadError] = useState(false);
  useEffect(() => () => {
    novu.clearCache();
    void novu.socket.disconnect();
  }, [novu]);
  const counter = useCounts({ filters: [{ read: false, archived: false }] });
  const feed = useNotifications({ archived: false });
  if (readError) return <>
    <p className="error" role="alert">This notification could not be marked as read. Please reload your notifications.</p>
    <button className="secondary" onClick={reload}>Retry notifications</button>
  </>;
  if (counter.error || feed.error) return <>
    <p className="error" role="alert">Your notifications could not be loaded. Please try again.</p>
    <button className="secondary" onClick={reload}>Retry notifications</button>
  </>;
  if (counter.isLoading || feed.isLoading) return <p role="status">Loading your notifications…</p>;
  return <>
    <p role="status">Unread notifications: {counter.counts[0].count}</p>
    <InboxContent hideNav renderDefaultActions={notification => <NotificationReadButton notification={notification} onReadError={setReadError} />} />
  </>;
}
