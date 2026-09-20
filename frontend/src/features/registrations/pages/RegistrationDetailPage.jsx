import { useParams, Link } from "react-router";
import { useRegistrationResource } from "../hooks/useRegistrationResource";
import RegistrationStatusBadge from "../components/RegistrationStatusBadge";
import WithdrawButton from "../components/WithdrawButton";
import { useEventRegistration } from "../hooks/useEventRegistration";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

function withdrawBlockReason(registration) {
  if (registration.status === "confirmed") {
    return "Your registration has been confirmed. Contact the organiser to withdraw.";
  }
  const start = registration.events?.start_time ? new Date(registration.events.start_time) : null;
  if (!start) return null;
  const now = new Date();
  if (now >= start) return "This event has already started.";
  if (start - now < TWENTY_FOUR_HOURS) return "Withdrawals close 24 hours before the event.";
  return null;
}

function formatFieldKey(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function RegistrationDetailPage() {
  const { registrationId } = useParams();
  const { data, error: fetchError, setData } = useRegistrationResource(`/api/registrations/me/${registrationId}`);
  const registration = data?.registration;
  const { withdraw, busy, error: withdrawError } = useEventRegistration();

  async function handleWithdraw() {
    const updated = await withdraw(registrationId);
    if (updated) setData({ registration: { ...registration, ...updated } });
  }

  if (fetchError) {
    return (
      <section className="card">
        <Link to="/registrations/me" className="back-link">Back to my registrations</Link>
        <p className="error" role="alert">{fetchError}</p>
      </section>
    );
  }

  if (!registration) {
    return <section className="card"><p role="status">Loading registration…</p></section>;
  }

  const blockReason = withdrawBlockReason(registration);

  return (
    <section className="card" aria-labelledby="reg-detail-title">
      <Link to="/registrations/me" className="back-link">Back to my registrations</Link>
      <p className="eyebrow">REGISTRATION</p>
      <h1 id="reg-detail-title">Registration details</h1>
      <dl className="account-details">
        <div><dt>Status</dt><dd><RegistrationStatusBadge status={registration.status} /></dd></div>
        <div><dt>Registered</dt><dd>{new Date(registration.created_at).toLocaleDateString()}</dd></div>
        {new Date(registration.updated_at).getTime() !== new Date(registration.created_at).getTime() && (
          <div><dt>Last updated</dt><dd>{new Date(registration.updated_at).toLocaleDateString()}</dd></div>
        )}
      </dl>

      {registration.registration_data && Object.keys(registration.registration_data).length > 0 && (
        <>
          <h2 className="section-heading">Your submitted details</h2>
          <dl className="account-details">
            {Object.entries(registration.registration_data)
              .filter(([, v]) => v != null && v !== "")
              .map(([key, value]) => (
                <div key={key}><dt>{formatFieldKey(key)}</dt><dd>{value}</dd></div>
              ))}
          </dl>
        </>
      )}

      {withdrawError && <p className="error" role="alert">{withdrawError}</p>}
      {registration.status !== "withdrawn" && (
        blockReason
          ? <p className="card-note">{blockReason}</p>
          : <WithdrawButton onWithdraw={handleWithdraw} busy={busy} />
      )}
    </section>
  );
}

export default function RegistrationDetailPageRoute() {
  const { registrationId } = useParams();
  return <RegistrationDetailPage key={registrationId} />;
}
