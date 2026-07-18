import "server-only";

const configuredUserId = Number(process.env.WEBUI_USER_ID ?? "1");

if (!Number.isSafeInteger(configuredUserId) || configuredUserId <= 0) {
  throw new Error("WEBUI_USER_ID must be a positive integer.");
}

// This is the web app's current single-user boundary. Replace this lookup with
// the authenticated session's user id when web accounts are introduced.
export const WEBUI_USER_ID = configuredUserId;
