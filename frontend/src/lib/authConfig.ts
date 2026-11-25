import type { Configuration } from "@azure/msal-browser";

export const ENTRA_CLIENT_ID =
  import.meta.env.VITE_ENTRA_CLIENT_ID ?? "35a23094-bd45-4faa-8957-d52d17f0a1d6";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080"
).replace(/\/$/, "");

export const API_SCOPE = `api://${ENTRA_CLIENT_ID}/access_as_user`;

export const msalConfig: Configuration = {
  auth: {
    clientId: ENTRA_CLIENT_ID,
    authority: "https://login.microsoftonline.com/common",
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

export const loginRequest = {
  scopes: ["openid", "profile", "email", API_SCOPE],
};
