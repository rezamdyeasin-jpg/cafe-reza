// Deployment configuration — the single place that knows about domains
// and hosting. Nothing else in the app hardcodes a domain or a hosting
// URL.
//
// No Firebase credential or web API key is ever baked into shipped
// source: the Firebase web config is loaded at runtime from the
// server-side `getFirebaseConfig` action, which reads it only from the
// hosting environment (FIREBASE_API_KEY / FIREBASE_PROJECT_ID /
// FIREBASE_APP_ID and friends). When the hosting environment provides
// none of those, Firebase Auth stays unavailable and every Firebase
// call in ./firebase.ts reports that honestly instead of pretending.
// See README.md for the hosting steps.
//
// Vite-style env access is read defensively so the bundle also works when
// no env file exists at all.
const env = (
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
) as Record<string, string | undefined>;

const pick = (key: string): string => (env[key] ?? "").trim();

/** Public base URL of this deployment, e.g. https://cafe.example.com.
 *  Empty means "whatever origin served this page" — all in-app links and
 *  API calls are relative, so an empty value is the normal, portable case. */
export const APP_URL = pick("VITE_APP_URL");

/** App Check reCAPTCHA Enterprise site key. Empty = App Check is not
 *  enabled. Never a secret in code: set only in hosting env/secret settings. */
export const FIREBASE_APPCHECK_KEY = pick("VITE_FIREBASE_APPCHECK_KEY");

/** Canonical URL helper: returns a path unchanged when no APP_URL is set,
 *  so links never depend on a baked-in domain. */
export function absoluteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return APP_URL ? `${APP_URL.replace(/\/$/, "")}${p}` : p;
}
