import { Link } from "react-router";
import Icon from "../../../components/ui/Icon";
import { useApiResource } from "../../../hooks/useApiResource";

function formatStarted(value) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// SCRUM-147 AC3/AC4: the organiser's own drafts. The server returns only the
// caller's drafts; they never appear in the shared organisation list.
export default function DraftList() {
  const { data, loading, error } = useApiResource("/api/events/drafts");
  return (
    <section className="event-request-group event-request-group--drafts" aria-labelledby="draft-events-title">
      <h2 id="draft-events-title">Your drafts {data && <span className="event-request-count" aria-hidden="true">{data.drafts.length}</span>}</h2>
      <p>Only you can see your drafts. Open one to continue editing and submit it.</p>
      {loading && <p role="status">Loading drafts…</p>}
      {error && <p role="alert">{error}</p>}
      {data?.drafts.length === 0 && <p>You have no drafts.</p>}
      {data?.drafts.length > 0 && (
        <ul className="event-workspace-list event-request-list">
          {data.drafts.map((draft) => (
            <li key={draft.id}>
              <Link
                className="event-request-link event-request-link--draft"
                to={`/events/new?draft=${encodeURIComponent(draft.id)}`}
                aria-labelledby={`event-draft-title-${draft.id}`}
                aria-describedby={`event-draft-meta-${draft.id}`}
              >
                <span className="event-request-icon"><Icon name="request" size={22} /></span>
                <div className="event-request-content">
                  <h3 className="event-request-title" id={`event-draft-title-${draft.id}`}>{draft.name}</h3>
                  <div className="event-request-meta" id={`event-draft-meta-${draft.id}`}>
                    <span className="status-badge status-draft">Draft</span>
                    <span><Icon name="clock" size={15} />Started {formatStarted(draft.created_at)}</span>
                  </div>
                </div>
                <span className="event-request-open" aria-hidden="true">Continue draft <Icon name="arrow" size={18} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
