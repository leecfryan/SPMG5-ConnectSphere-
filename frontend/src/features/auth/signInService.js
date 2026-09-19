// Form limits are input safeguards, not password policy or account eligibility rules.
export const SIGN_IN_LIMITS = Object.freeze({ email: 254, password: 1024 });

function signInErrorMessage(error) {
  if (error.status === 429) {
    return "Too many sign-in attempts. Please wait a moment and try again.";
  }
  if (!error.status || error.status >= 500) {
    return "Sign-in is temporarily unavailable. Please try again.";
  }
  // Never reveal whether an account exists or display provider error details.
  return "Unable to sign in. Check your email and password and try again.";
}

export async function signInWithCredentials(client, { email, password }) {
  try {
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      // Password whitespace is significant; submit exactly what the user entered.
      password,
    });
    return error ? signInErrorMessage(error) : "";
  } catch {
    return "Unable to connect. Check your connection and try again.";
  }
}
