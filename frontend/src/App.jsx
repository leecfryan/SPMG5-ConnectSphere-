import EventRequestPage from "./features/events/pages/EventRequestPage";
import "./App.css";

export default function App() {
  return (
    <div className="app-shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        ConnectSphere
      </header>
      <main className="wide">
        <aside className="intro">
          <p className="eyebrow">EVENT PLANNING &amp; VENUE BOOKING</p>
          <h2>
            Plan it once.
            <br />
            Share it with everyone.
          </h2>
          <p>
            Describe the event you have in mind. Save it as a draft and keep
            editing until it is ready to go to the team.
          </p>
          <div className="intro-line" aria-hidden="true" />
          <span className="intro-caption">
            From the first idea to the final detail.
          </span>
        </aside>
        <EventRequestPage />
      </main>
      <footer>ConnectSphere Event Services</footer>
    </div>
  );
}
