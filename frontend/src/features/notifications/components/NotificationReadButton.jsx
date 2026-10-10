import { useState } from "react";

export default function NotificationReadButton({ notification, onReadError }) {
  const [pending, setPending] = useState(false);
  async function markRead(event) {
    event.stopPropagation();
    setPending(true);
    onReadError(false);
    try {
      const result = await notification.read();
      if (result.error) onReadError(true);
    } catch {
      onReadError(true);
    } finally {
      setPending(false);
    }
  }
  if (notification.isRead) return <span>Read</span>;
  return <>
    <button disabled={pending} onClick={markRead}>{pending ? "Marking as read…" : "Mark as read"}</button>
  </>;
}
