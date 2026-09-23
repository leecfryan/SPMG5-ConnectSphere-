import { expect, test, vi } from "vitest";
import { signInWithCredentials } from "./signInService";

// The behaviour being tested is to remove spaces around the email address, but preserve the password exactly. Checks for code behaviour without contacting supabase.
test("[AUTH-SERVICE-001] Normalize email whitespace while preserving the exact password", async () => {
  //Prepare a fake auth dependency
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
  //Makes that fake return a specified asynchronous result

  const fakeClient = {
    auth: { signInWithPassword },
  };

  const message = await signInWithCredentials(fakeClient, {
    email: "  person@client.sg  ",
    password: "  Password with spaces  ",
  });

  expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({
    email: "person@client.sg",
    password: "  Password with spaces  ",
  });

  expect(message).toBe("");
});

test("[AUTH-SERVICE-002] Show a helpful message when sign-in is rate-limited", async () => {
  //simulate the authentication provider returning HTTP 429
  const fakeClient = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: { status: 429 } }),
    },
  };

  //Act
  const message = await signInWithCredentials(fakeClient, {
    email: "person@client.sg",
    password: "ExamplePassword123!",
  });

  //Assert
  expect(message).toBe(
    "Too many sign-in attempts. Please wait a moment and try again.",
  );
});

test("[AUTH-SERVICE-003] Hide provider details when credentials are invalid", async () => {
  //Arrange: simulate an authentication failure.
  const fakeClient = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        error: {
          status: 400,
          message: "Account person@client.sg does not exist",
        },
      }),
    },
  };

  //Act: run your real sign-in function
  const message = await signInWithCredentials(fakeClient, {
    email: "person@client.sg",
    password: "WrongPassword!",
  });

  //Assert: return only the safe, generic message.
  expect(message).toBe(
    "Unable to sign in. Check your email and password and try again.",
  );
});

test("[AUTH-SERVICE-004] Show a message when the auth server fails", async () => {
  const fakeClient = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        error: {
          status: 500,
        },
      }),
    },
  };
  const message = await signInWithCredentials(fakeClient, {
    email: "person@client.sg",
    password: "password!",
  });

  expect(message).toBe("Sign-in is temporarily unavailable. Please try again.");
});

test("[AUTH-SERVICE-005] Show an unavailable message when an error has no status", async () => {
  const fakeClient = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        error: {},
      }),
    },
  };
  const message = await signInWithCredentials(fakeClient, {
    email: "person@client.sg",
    password: "password!",
  });

  expect(message).toBe("Sign-in is temporarily unavailable. Please try again.");
});

test("[AUTH-SERVICE-006] Show a connection message when authentication throws", async () => {
  // Arrange: simulate a rejected authentication request.
  const fakeClient = {
    auth: {
      signInWithPassword: vi
        .fn()
        .mockRejectedValue(new Error("Network request failed")),
    },
  };

  // Act.
  const message = await signInWithCredentials(fakeClient, {
    email: "person@client.sg",
    password: "ExamplePassword123!",
  });

  // Assert.
  expect(message).toBe(
    "Unable to connect. Check your connection and try again.",
  );
});
