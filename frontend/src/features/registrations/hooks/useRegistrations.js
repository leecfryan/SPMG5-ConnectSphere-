import { useRegistrationResource } from "./useRegistrationResource";

export function useRegistrations() {
  const { data, error, loading, reload } = useRegistrationResource("/api/registrations/me");
  return {
    registrations: data?.registrations ?? [],
    offers: data?.offers ?? [],
    waitlist: data?.waitlist ?? [],
    error,
    loading,
    reload,
  };
}
