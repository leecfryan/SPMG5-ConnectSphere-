import { Link } from "react-router";
import { useApiResource } from "../../../hooks/useApiResource";
import { workspaces } from "../workspaces";
import "../workspace.css";

export default function EventWorkspacePage({ scope }) {
  const workspace = workspaces[scope];
  const { data, loading, error, reload } = useApiResource(`/api/event-workspace/${scope}`);
  return <section className="card event-workspace">
    <h1>{workspace.title}</h1>
    <p>{workspace.description}</p>
    <button type="button" onClick={reload}>Refresh events</button>
    {loading && <p role="status">Loading events…</p>}
    {error && <p role="alert">{error}</p>}
    {data?.events.length === 0 && <p>No events to show yet.</p>}
    <ul className="event-workspace-list">
      {data?.events.map(event => <li key={event.id}>
        <Link to={`${workspace.path}/${event.id}`}>{event.name}</Link>
        <span>{event.status} · {event.coordinator_id ? "Coordinator assigned" : "Awaiting coordinator"}</span>
      </li>)}
    </ul>
    {scope === "organiser" && <Link to="/events/new">Submit an event request</Link>}
  </section>;
}
