import { useRegistrationResource } from "./useRegistrationResource";

export function useRegistrations() {
  const { data, error, loading, reload } = useRegistrationResource("/api/registrations/me");
  return { registrations: data?.registrations ?? [], error, loading, reload };
}
