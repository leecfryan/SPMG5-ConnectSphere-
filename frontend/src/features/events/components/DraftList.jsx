import { Link } from "react-router";
import { useApiResource } from "../../../hooks/useApiResource";

function formatStarted(value) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// SCRUM-147 AC3/AC4: the organiser's own drafts. The server returns only the
// caller's drafts; they never appear in the shared organisation list.
export default function DraftList() {
  const { data, loading, error } = useApiResource("/api/events/drafts");
  return (
    <section aria-labelledby="draft-events-title">
      <h2 id="draft-events-title">Your drafts</h2>
      <p>Only you can see your drafts. Open one to continue editing and submit it.</p>
      {loading && <p role="status">Loading drafts…</p>}
      {error && <p role="alert">{error}</p>}
      {data?.drafts.length === 0 && <p>You have no drafts.</p>}
      {data?.drafts.length > 0 && (
        <ul className="event-workspace-list">
          {data.drafts.map((draft) => (
            <li key={draft.id}>
              <Link to={`/events/new?draft=${encodeURIComponent(draft.id)}`}>{draft.name}</Link>
              <span>Draft · started {formatStarted(draft.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
