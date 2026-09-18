import { useEffect, useState } from "react";
import { fetchEventMessages, postEventMessage, updateMessage } from "../../../lib/api";

const ROLE_LABEL = { tech_support: "Technical Support", event_coordinator: "Event Coordinator" };

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Scrum-28-Scrum65 (AC3): a clarification thread for one event, shared by
// both the Technical Support dashboard and the Coordinator's equipment
// request page (Scrum-28-Scrum66 / AC4: both roles see the same thread).
// `lines` is [{ id, label }] - the event's equipment_request rows - because
// every message links to one specific line (the real messages table has
// equipment_request_id as NOT NULL, not an optional link).
function ClarificationThread({ eventId, lines, token, currentUserId }) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [lineId, setLineId] = useState("");
  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    if (!token || !eventId) return;
    setIsLoading(true);
    setLoadError(null);
    // Guards against a stale response clobbering a newer one if eventId
    // changes again before this fetch resolves - same reasoning as
    // EquipmentRequestPage's request-list effect.
    let cancelled = false;
    fetchEventMessages(eventId, token)
      .then((data) => { if (!cancelled) setMessages(data); })
      .catch((err) => { if (!cancelled) setLoadError(err.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, token]);

  function lineLabel(equipmentRequestId) {
    return lines.find((l) => l.id === equipmentRequestId)?.label || equipmentRequestId;
  }

  function handleSend(event) {
    event.preventDefault();
    setIsPosting(true);
    setPostError(null);
    postEventMessage(eventId, lineId, draft, token)
      .then((message) => {
        setMessages((prev) => [...prev, message]);
        setDraft("");
      })
      .catch((err) => setPostError(err.message))
      .finally(() => setIsPosting(false));
  }

  function startEdit(message) {
    setEditingId(message.id);
    setEditDraft(message.body);
  }

  function saveEdit(id) {
    setIsSavingEdit(true);
    updateMessage(id, editDraft, token)
      .then((updated) => {
        setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
        setEditingId(null);
      })
      .catch((err) => setPostError(err.message))
      .finally(() => setIsSavingEdit(false));
  }

  return (
    <div className="eq-thread">
      <p className="eq-thread-heading">Clarification thread</p>

      {loadError && <p className="eq-error">Could not load thread: {loadError}</p>}
      {isLoading && <p className="eq-hint">Loading thread…</p>}
      {!isLoading && messages.length === 0 && !loadError && (
        <p className="eq-hint">No messages yet.</p>
      )}

      <ul className="eq-thread-list">
        {messages.map((m) => (
          <li key={m.id} className="eq-thread-message">
            <div className="eq-thread-message-header">
              <span className="eq-thread-author">{ROLE_LABEL[m.author_role] || m.author_role}</span>
              <span className="eq-thread-line-tag">{lineLabel(m.equipment_request_id)}</span>
              <span className="eq-thread-time">
                {formatTimestamp(m.created_at)}
                {m.updated_at ? " (edited)" : ""}
              </span>
            </div>

            {editingId === m.id ? (
              <div className="eq-thread-edit">
                <textarea
                  rows="2"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                />
                <div className="eq-thread-edit-actions">
                  <button type="button" className="eq-secondary" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="eq-primary"
                    disabled={isSavingEdit || editDraft.trim() === ""}
                    onClick={() => saveEdit(m.id)}
                  >
                    {isSavingEdit ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="eq-thread-body">{m.body}</p>
            )}

            {m.author_id === currentUserId && editingId !== m.id && (
              <button type="button" className="eq-thread-edit-link" onClick={() => startEdit(m)}>
                Edit
              </button>
            )}
          </li>
        ))}
      </ul>

      {lines.length === 0 ? (
        <p className="eq-hint">Add an equipment request first to start a clarification thread.</p>
      ) : (
        <form className="eq-thread-compose" onSubmit={handleSend}>
          <label className="eq-field">
            About
            <span className="eq-select-wrap">
              <select value={lineId} onChange={(e) => setLineId(e.target.value)} required>
                <option value="" disabled>Select an equipment line...</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
              <svg className="eq-field-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path d="M5 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </label>
          <label className="eq-field">
            Message
            <textarea
              rows="2"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Record a question, comment, or clarification need…"
              required
            />
          </label>
          {postError && <p className="eq-error">{postError}</p>}
          <button type="submit" className="eq-primary" disabled={isPosting || !lineId || draft.trim() === ""}>
            {isPosting ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </div>
  );
}

export default ClarificationThread;
