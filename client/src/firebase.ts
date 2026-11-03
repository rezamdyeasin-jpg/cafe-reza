// Live Firebase wiring. No Firebase credential is baked into shipped
// source: the web config is fetched at runtime from the server-side
// `getFirebaseConfig` action, which reads it only from the hosting
// environment. When the hosting environment provides no config,
// Firebase Auth stays unavailable and every call below reports that
// honestly — no verification mail is pretended sent.
// The app's primary data store stays its own server actions + database
// (Demo Mode fallback). Firebase Auth is used for real Google sign-in,
// and Firestore is reached through its REST API (the Firestore JS SDK
// bundle is not used: it contains an internal .eval() helper the
// artifact bundler rejects) as a live mirror the owner publishes to
// after deploying the strict rules in firestore.rules. Every call here
// reports its real result: nothing is simulated, and a failed call
// never looks successful.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { FIREBASE_APPCHECK_KEY } from "./config";

const MISSING_API_KEY_EN = "Firebase is not configured: the hosting environment does not provide the Firebase web config. Set FIREBASE_API_KEY, FIREBASE_PROJECT_ID and FIREBASE_APP_ID in the hosting environment (values from Firebase Console → Project settings → Your apps → “Cafe Reza Web”), and rotate/restrict the previously exposed web API key in the Console. No verification email was sent.";
const MISSING_API_KEY_BN = "Firebase কনফিগার করা হয়নি: হোস্টিং এনভায়রনমেন্টে Firebase ওয়েব কনফিগ নেই। হোস্টিং এনভায়রনমেন্টে FIREBASE_API_KEY, FIREBASE_PROJECT_ID ও FIREBASE_APP_ID বসান (Firebase Console → Project settings → Your apps → “Cafe Reza Web” থেকে নিয়ে), আর Console-এ আগের প্রকাশিত ওয়েব API key-টি রোটেট/সীমিত করুন। কোনো যাচাই মেইল পাঠানো হয়নি।";

export type FirebaseRuntimeConfig = {
  configured: boolean;
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
};

const EMPTY_CONFIG: FirebaseRuntimeConfig = {
  configured: false, apiKey: "", authDomain: "", projectId: "",
  storageBucket: "", messagingSenderId: "", appId: "", measurementId: "",
};

let configPromise: Promise<FirebaseRuntimeConfig> | null = null;
let runtimeProjectId = "cafe-reza";

// Fetched once per page load from the server, which reads the hosting
// environment. The key is held only in memory for this session and
// never written to shipped source, storage, or logs.
async function loadFirebaseConfig(): Promise<FirebaseRuntimeConfig> {
  if (!configPromise) {
    configPromise = (async () => {
      try {
        const { api } = await import("./api");
        const cfg = await api.getFirebaseConfig({});
        if (cfg.projectId) runtimeProjectId = cfg.projectId;
        return cfg;
      } catch {
        return EMPTY_CONFIG;
      }
    })();
  }
  return configPromise;
}

export async function isFirebaseConfigured(): Promise<boolean> {
  return (await loadFirebaseConfig()).configured;
}

let app: FirebaseApp | null = null;
let appError = "";
let appCheckState: "idle" | "on" | "missing-key" | "failed" = "idle";
let appCheckError = "";

export async function getFirebaseApp(): Promise<FirebaseApp | null> {
  const cfg = await loadFirebaseConfig();
  if (!cfg.configured) { appError = MISSING_API_KEY_EN; return null; }
  if (app) return app;
  try {
    const existing = getApps()[0];
    app = existing ?? initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId,
      ...(cfg.measurementId ? { measurementId: cfg.measurementId } : {}),
    });
    return app;
  } catch (e) {
    appError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

export function firebaseAppError(): string {
  return appError;
}

async function ensureAppCheck(): Promise<void> {
  if (appCheckState === "on" || appCheckState === "missing-key") return;
  if (!FIREBASE_APPCHECK_KEY) { appCheckState = "missing-key"; return; }
  const fbApp = await getFirebaseApp();
  if (!fbApp) { appCheckState = "failed"; return; }
  try {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("firebase/app-check");
    initializeAppCheck(fbApp, { provider: new ReCaptchaEnterpriseProvider(FIREBASE_APPCHECK_KEY), isTokenAutoRefreshEnabled: true });
    appCheckState = "on";
  } catch (e) {
    appCheckState = "failed";
    appCheckError = e instanceof Error ? e.message : String(e);
  }
}

export function appCheckStatus(): { state: string; error: string } {
  return { state: appCheckState, error: appCheckError };
}

export type GoogleLinkResult = { ok: boolean; token?: string; firebaseEmail?: string; error?: string };

// Real Google sign-in: Firebase Auth popup, then the ID token is verified
// server-side (linkGoogleAccount) before any app session is created.
// The Firebase session stays signed in (the app session itself is the
// separate cr_token) so Firestore calls can use the Firebase ID token;
// signing in with Google alone never creates an app session.
export async function signInWithGoogleAndLink(): Promise<GoogleLinkResult> {
  if (!(await isFirebaseConfigured())) return { ok: false, error: `${MISSING_API_KEY_EN} Use email and password below.` };
  const fbApp = await getFirebaseApp();
  if (!fbApp) return { ok: false, error: `Firebase could not start: ${appError || "unknown error"}` };
  try {
    await ensureAppCheck();
    const { getAuth, GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const auth = getAuth(fbApp);
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const email = cred.user.email;
    const idToken = await cred.user.getIdToken();
    const { api } = await import("./api");
    const r = await api.linkGoogleAccount({ idToken });
    if (!r.ok || !r.token) return { ok: false, error: r.error ?? "Google sign-in could not be verified for this app." };
    return { ok: true, token: r.token, firebaseEmail: email ?? undefined };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "auth/operation-not-allowed") return { ok: false, error: "Google sign-in is not enabled in Firebase Console → Authentication → Sign-in method. Enable the Google provider, then try again." };
    if (code === "auth/unauthorized-domain") return { ok: false, error: "This website's domain is not in Firebase Console → Authentication → Settings → Authorized domains. Add this domain, then try again." };
    if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") return { ok: false, error: "The Google sign-in window was blocked or closed. Allow popups for this site and try again." };
    if (code === "auth/network-request-failed") return { ok: false, error: "Could not reach Google/Firebase. Check the connection and try again." };
    return { ok: false, error: `Google sign-in failed (${code || "unknown"}): ${msg}` };
  }
}

export type FirebaseEmailResult = { ok: boolean; alreadyVerified?: boolean; error?: string };

function firebaseAuthErrorMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  if (code === "auth/operation-not-allowed") return "Firebase Console → Authentication → Sign-in method-এ Email/Password চালু করা হয়নি। মালিককে সেখানে গিয়ে Email/Password Enable করতে হবে, তারপর আবার চেষ্টা করুন।";
  if (code === "auth/invalid-email") return "ইমেইল ঠিকানাটি সঠিক নয়।";
  if (code === "auth/user-not-found" || code === "auth/wrong-password") return "Firebase-এ এই ইমেইল/পাসওয়ার্ড মেলেনি। অ্যাকাউন্টের পাসওয়ার্ডটি আবার লিখুন।";
  if (code === "auth/too-many-requests") return "অনেকবার চেষ্টা হয়েছে — Firebase কিছুক্ষণ আটকে রেখেছে। একটু পরে আবার চেষ্টা করুন।";
  if (code === "auth/network-request-failed") return "Firebase-এর সাথে সংযোগ হচ্ছে না। ইন্টারনেট চেক করে আবার চেষ্টা করুন।";
  return `Firebase ব্যর্থ হয়েছে (${code || "unknown"}): ${msg}`;
}

// Returns the Firebase user for this email: the already-signed-in user
// (e.g. after Continue with Google), or an email/password sign-in,
// creating the Firebase user first when none exists for this email yet
// (older site-only accounts have no Firebase user until now). The
// password is used only for this Firebase sign-in and is never sent to
// the site's own server actions.
async function ensureFirebaseUser(email: string, password?: string): Promise<{ ok: boolean; user?: import("firebase/auth").User; needPassword?: boolean; error?: string }> {
  if (!(await isFirebaseConfigured())) return { ok: false, error: MISSING_API_KEY_BN };
  const fbApp = await getFirebaseApp();
  if (!fbApp) return { ok: false, error: `Firebase চালু করা যায়নি: ${appError || "অজানা ত্রুটি"}` };
  try {
    await ensureAppCheck();
    const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import("firebase/auth");
    const auth = getAuth(fbApp);
    const current = auth.currentUser;
    if (current && current.email?.toLowerCase() === email.toLowerCase()) return { ok: true, user: current };
    if (!password) return { ok: false, needPassword: true, error: "Firebase-এ সাইন-ইন করা নেই। মেইল পাঠাতে/যাচাই করতে নিচে আপনার অ্যাকাউন্টের পাসওয়ার্ডটি লিখুন (Google দিয়ে সাইন-ইন করা থাকলে পাসওয়ার্ড লাগবে না)।" };
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return { ok: true, user: cred.user };
    } catch (signInErr) {
      const code = (signInErr as { code?: string }).code ?? "";
      if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          return { ok: true, user: cred.user };
        } catch (createErr) {
          const createCode = (createErr as { code?: string }).code ?? "";
          if (createCode === "auth/email-already-in-use") return { ok: false, error: "Firebase-এ এই ইমেইল/পাসওয়ার্ড মেলেনি। অ্যাকাউন্টের পাসওয়ার্ডটি আবার লিখুন।" };
          return { ok: false, error: firebaseAuthErrorMessage(createErr) };
        }
      }
      return { ok: false, error: firebaseAuthErrorMessage(signInErr) };
    }
  } catch (e) {
    return { ok: false, error: firebaseAuthErrorMessage(e) };
  }
}

// Firebase verification email: Firebase itself sends the link to the
// Gmail (no Resend/SMTP config needed). Requires the Email/Password
// provider enabled in Firebase Console → Authentication → Sign-in
// method; when it is not enabled Firebase answers
// auth/operation-not-allowed and that is reported honestly.
export async function sendFirebaseVerificationEmail(email: string, password?: string): Promise<FirebaseEmailResult> {
  const ensured = await ensureFirebaseUser(email, password);
  if (!ensured.ok || !ensured.user) return { ok: false, error: ensured.error ?? "Firebase সাইন-ইন করা যায়নি।" };
  try {
    await ensured.user.reload();
    if (ensured.user.emailVerified) return { ok: true, alreadyVerified: true };
    const { sendEmailVerification } = await import("firebase/auth");
    await sendEmailVerification(ensured.user);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: firebaseAuthErrorMessage(e) };
  }
}

// Creates the Firebase email/password user for a freshly registered
// site account and sends Firebase's verification email. When a
// Firebase user already exists for the email (e.g. registered before
// the old account was deleted), it signs in and resends instead.
export async function registerFirebaseEmailUser(email: string, password: string): Promise<FirebaseEmailResult> {
  if (!(await isFirebaseConfigured())) return { ok: false, error: MISSING_API_KEY_BN };
  const fbApp = await getFirebaseApp();
  if (!fbApp) return { ok: false, error: `Firebase চালু করা যায়নি: ${appError || "অজানা ত্রুটি"}` };
  try {
    await ensureAppCheck();
    const { getAuth, createUserWithEmailAndPassword, sendEmailVerification } = await import("firebase/auth");
    const auth = getAuth(fbApp);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(cred.user);
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/email-already-in-use") return sendFirebaseVerificationEmail(email, password);
    return { ok: false, error: firebaseAuthErrorMessage(e) };
  }
}

// After the user clicks the link in Firebase's verification email: takes
// a fresh Firebase ID token and lets the server verify it with Google
// before marking the site account verified. The client never decides
// verification on its own.
export async function confirmFirebaseEmailVerified(artifactToken: string, email: string, password?: string): Promise<FirebaseEmailResult> {
  const ensured = await ensureFirebaseUser(email, password);
  if (!ensured.ok || !ensured.user) return { ok: false, error: ensured.error ?? "Firebase সাইন-ইন করা যায়নি।" };
  try {
    await ensured.user.reload();
    const idToken = await ensured.user.getIdToken(true);
    const { api } = await import("./api");
    const r = await api.confirmFirebaseEmailVerified({ token: artifactToken, idToken });
    if (!r.ok) return { ok: false, error: r.error ?? "Firebase যাচাই সম্পূর্ণ করা যায়নি।" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: firebaseAuthErrorMessage(e) };
  }
}

export type FirebaseProbe = {
  configured: boolean;
  configDetail: string;
  appReady: boolean;
  appError: string;
  appCheck: string;
  firestore: string;
  firestoreDetail: string;
  firebaseUser: string;
};

// --- Firestore REST helpers (no Firestore JS SDK in the bundle) ---

function firestoreDocUrl(collection: string, id: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(runtimeProjectId)}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
}

function firestoreValue(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(firestoreValue) } };
  if (typeof v === "object") {
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = firestoreValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function firestoreFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) fields[k] = firestoreValue(v);
  return fields;
}

async function firebaseIdToken(): Promise<{ token: string; email: string } | null> {
  const fbApp = await getFirebaseApp();
  if (!fbApp) return null;
  try {
    const { getAuth } = await import("firebase/auth");
    const user = getAuth(fbApp).currentUser;
    if (!user) return null;
    return { token: await user.getIdToken(), email: user.email ?? user.uid };
  } catch {
    return null;
  }
}

// Honest live check: initializes the app, notes App Check state, reads one
// Firestore document over REST (which Production-mode deny-by-default
// rules reject until firestore.rules is deployed), and reports the
// Firebase user, if any.
export async function probeFirebase(): Promise<FirebaseProbe> {
  const cfg = await loadFirebaseConfig();
  const configDetail = cfg.configured
    ? `project ${cfg.projectId}, app ${cfg.appId} — complete (from the hosting environment).`
    : `project ${cfg.projectId || "cafe-reza"} — not configured: the hosting environment does not provide FIREBASE_API_KEY / FIREBASE_PROJECT_ID / FIREBASE_APP_ID.`;
  const base: FirebaseProbe = { configured: cfg.configured, configDetail, appReady: false, appError: "", appCheck: "not enabled", firestore: "not checked", firestoreDetail: "", firebaseUser: "" };
  const fbApp = await getFirebaseApp();
  if (!fbApp) { base.appError = appError || MISSING_API_KEY_EN; return base; }
  base.appReady = true;
  await ensureAppCheck();
  base.appCheck = appCheckState === "on" ? "enabled" : appCheckState === "missing-key" ? "not enabled — no App Check site key in env" : appCheckState === "failed" ? `failed: ${appCheckError}` : "not enabled";
  const id = await firebaseIdToken();
  base.firebaseUser = id?.email ?? "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(firestoreDocUrl("settings", "cafe"), {
      headers: id ? { Authorization: `Bearer ${id.token}` } : {},
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 200) {
      base.firestore = "reachable";
      base.firestoreDetail = "settings/cafe document exists.";
    } else if (res.status === 404) {
      base.firestore = "reachable";
      base.firestoreDetail = "Connected. settings/cafe does not exist yet — publish the catalog snapshot from the admin panel.";
    } else if (res.status === 403 || res.status === 401) {
      base.firestore = "blocked";
      base.firestoreDetail = "Firestore denied the read (Production-mode rules). Deploy firestore.rules from this project, then check again.";
    } else {
      base.firestore = "blocked";
      base.firestoreDetail = `Firestore answered HTTP ${res.status}.`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    base.firestore = "blocked";
    base.firestoreDetail = msg.includes("abort") ? "Firestore did not answer in 8 seconds." : `Firestore error: ${msg}`;
  }
  return base;
}

// Publishes a catalog snapshot to Firestore (settings + products) as a
// live mirror, via the Firestore REST commit endpoint. Requires a
// signed-in Firebase user (Continue with Google); fails honestly when
// the deployed rules deny the write. The artifact database stays the
// source of truth until the owner verifies the mirror.
export async function mirrorCatalogToFirestore(products: Array<Record<string, unknown>>, settings: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!(await isFirebaseConfigured())) return { ok: false, error: MISSING_API_KEY_EN };
  const fbApp = await getFirebaseApp();
  if (!fbApp) return { ok: false, error: `Firebase could not start: ${appError || "unknown error"}` };
  const id = await firebaseIdToken();
  if (!id) return { ok: false, error: "Sign in with Continue with Google first, then publish. Firestore writes need a signed-in Firebase user." };
  const now = new Date().toISOString();
  const writes: Array<Record<string, unknown>> = [
    { update: { name: firestoreDocUrl("settings", "cafe"), fields: firestoreFields({ ...settings, updatedAt: now, source: "cafe-reza-artifact" }) } },
    ...products.map((p) => ({
      update: {
        name: firestoreDocUrl("products", String(p.id ?? p.slug ?? "unknown")),
        fields: firestoreFields({ ...p, updatedAt: now }),
      },
    })),
    { update: { name: firestoreDocUrl("meta", "lastSync"), fields: firestoreFields({ at: now, by: id.email, products: products.length }) } },
  ];
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(runtimeProjectId)}/databases/(default)/documents:commit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${id.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    if (res.status === 403 || res.status === 401) {
      return { ok: false, error: "Firestore denied the write (Production-mode rules). Deploy firestore.rules from this project, then try again." };
    }
    if (!res.ok) return { ok: false, error: `Firestore publish failed (HTTP ${res.status}).` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Firestore publish failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
