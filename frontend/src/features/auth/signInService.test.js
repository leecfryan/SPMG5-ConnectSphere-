import { expect, test, vi } from "vitest";
import { signInWithCredentials } from "./signInService";

test("[AUTH-SERVICE-001] Normalize email whitespace while preserving the exact password", async () => {
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
  const message = await signInWithCredentials({ auth: { signInWithPassword } }, {
    email: "  person@client.sg  ", password: "  Password with spaces  ",
  });
  expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({
    email: "person@client.sg", password: "  Password with spaces  ",
  });
  expect(message).toBe("");
});
