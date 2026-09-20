import { useAuth } from "../features/auth/useAuth";
import StaffResponsibilities from "../features/auth/StaffResponsibilities";

export default function ResponsibilitiesPage() {
  const { token } = useAuth();
  return (
    <section className="card" aria-labelledby="staff-title">
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1 id="staff-title">Staff access</h1>
      <StaffResponsibilities key={token} token={token} />
    </section>
  );
}
