import { Link } from "react-router";
import Icon from "../../../components/ui/Icon";
import RegistrationStatusBadge from "./RegistrationStatusBadge";

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function RegistrationCard({ registration }) {
  const eventName = registration.events?.name ?? "Unknown event";
  const eventDate = registration.events?.start_time;

  return (
    <li>
      <Link to={`/registrations/me/${registration.id}`} className="registration-card__link">
        <span className="registration-card__icon"><Icon name="ticket" size={24} /></span>
        <div className="registration-card__body">
          <span className="registration-card__event">{eventName}</span>
          {eventDate && (
            <span className="registration-card__date">{formatDate(eventDate)}</span>
          )}
        </div>
        <RegistrationStatusBadge status={registration.status} />
        <Icon name="arrow" size={18} />
      </Link>
    </li>
  );
}
