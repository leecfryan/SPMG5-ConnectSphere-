import {
  formatRegistrationCountdown,
  formatRegistrationTime,
} from "../useRegistrationWindow";

export default function RegistrationWindowNotice({ event, state, showRetry = true }) {
  const { status, remaining, checkFailed, retry, hasWindow } = state;
  if (!hasWindow) return null;

  const messageId = `registration-window-message-${event.id}`;
  let message;
  if (status === "closed") {
    message = `Registration closed on ${formatRegistrationTime(event.registration_end)}.`;
  } else if (status === "open" && event.registration_end) {
    message = `Registration closes on ${formatRegistrationTime(event.registration_end)}.`;
  } else if (status === "not-open") {
    message = `Registration opens on ${formatRegistrationTime(event.registration_start)}.`;
  } else if (status === "checking" && checkFailed) {
    message = "Registration availability could not be confirmed.";
  } else if (status === "checking") {
    message = "Checking registration availability with the server…";
  }

  return (
    <div className="registration-window-notice" id={messageId}>
      <p role="status">{message}</p>
      {status === "not-open" && remaining && (
        <p>Opens in {formatRegistrationCountdown(remaining)}.</p>
      )}
      {checkFailed && <p>Server confirmation is still pending; registration remains disabled.</p>}
      {showRetry && checkFailed && (
        <button className="secondary" type="button" onClick={retry}>Check again</button>
      )}
    </div>
  );
}
