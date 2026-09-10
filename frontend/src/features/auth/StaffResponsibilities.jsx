import { useEffect, useState } from "react";

export default function StaffResponsibilities({ token }) {
  const [responsibilities, setResponsibilities] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/internal/access", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Your staff access is unavailable. Sign in again or contact your coordinator.");
      }
      if (!response.ok) throw new Error("We couldn’t load your responsibilities. Please try again.");
      const data = await response.json();
      if (!controller.signal.aborted) setResponsibilities(data.responsibilities);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message || "Unable to load your responsibilities.");
    });
    return () => controller.abort();
  }, [token, attempt]);

  return (
    <section className="responsibilities" aria-labelledby="responsibilities-title">
      <h2 id="responsibilities-title">Your responsibilities</h2>
      {error ? (
        <>
          <p className="error" role="alert">{error}</p>
          <button className="secondary" onClick={() => { setError(""); setAttempt(attempt + 1); }}>Retry staff access</button>
        </>
      ) : responsibilities ? (
        <ul>{responsibilities.map(({ permission, label }) => <li key={permission}>{label}</li>)}</ul>
      ) : <p role="status">Checking your staff access…</p>}
    </section>
  );
}
