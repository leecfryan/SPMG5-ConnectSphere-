import { createClient } from "@supabase/supabase-js";

let clientPromise;

export function getAuthClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch("/api/auth/config", { cache: "no-store" });
      if (!response.ok) throw new Error("Sign-in is temporarily unavailable. Please try again.");
      const { supabaseUrl, publishableKey } = await response.json();
      if (!supabaseUrl || !publishableKey) throw new Error("Sign-in is not configured yet.");
      return createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    })().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}
