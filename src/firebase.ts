// Firebase init for the standalone build. Config comes ONLY from build-time
// environment variables (VITE_FIREBASE_*). Nothing is baked into source.
// When the config is missing, every helper below reports that honestly
// and Firestore stays unreachable — the app never pretends to be live.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, type Firestore } from "firebase/firestore";
import { OWNER_EMAIL } from "./seed";

const env = import.meta.env as Record<string, string | undefined>;
const pick = (k: string) => (env[k] ?? "").trim();

export const FIREBASE_CONFIG = {
  apiKey: pick("VITE_FIREBASE_API_KEY"),
  authDomain: pick("VITE_FIREBASE_AUTH_DOMAIN") || "cafe-reza.firebaseapp.com",
  projectId: pick("VITE_FIREBASE_PROJECT_ID") || "cafe-reza",
  storageBucket: pick("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: pick("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: pick("VITE_FIREBASE_APP_ID"),
  ...(pick("VITE_FIREBASE_MEASUREMENT_ID") ? { measurementId: pick("VITE_FIREBASE_MEASUREMENT_ID") } : {}),
};
export const FIREBASE_APPCHECK_KEY = pick("VITE_FIREBASE_APPCHECK_KEY");

export const isFirebaseConfigured =
  FIREBASE_CONFIG.apiKey.length > 0 &&
  FIREBASE_CONFIG.projectId.length > 0 &&
  FIREBASE_CONFIG.appId.length > 0;

export const MISSING_CONFIG_EN =
  "Firebase is not configured: build this app with VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_APP_ID set (values from Firebase Console → Project settings → Your apps → “Cafe Reza Web”). No order or sign-in can work until then.";
export const MISSING_CONFIG_BN =
  "Firebase কনফিগার করা হয়নি: VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID ও VITE_FIREBASE_APP_ID বসিয়ে অ্যাপটি বিল্ড করুন (Firebase Console → Project settings → Your apps → “Cafe Reza Web” থেকে নিয়ে)। এগুলো না বসালে সাইন-ইন বা অর্ডার চলবে না।";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  if (app) return app;
  const existing = getApps()[0];
  app = existing ?? initializeApp(FIREBASE_CONFIG);
  return app;
}

export function getDb(): Firestore | null {
  if (!isFirebaseConfigured) return null;
  if (db) return db;
  const fbApp = getFirebaseApp();
  if (!fbApp) return null;
  db = getFirestore(fbApp);
  return db;
}

let appCheckState: "idle" | "on" | "missing-key" | "failed" = "idle";
export async function ensureAppCheck(): Promise<void> {
  if (appCheckState !== "idle") return;
  if (!FIREBASE_APPCHECK_KEY) { appCheckState = "missing-key"; return; }
  const fbApp = getFirebaseApp();
  if (!fbApp) { appCheckState = "failed"; return; }
  try {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("firebase/app-check");
    initializeAppCheck(fbApp, { provider: new ReCaptchaEnterpriseProvider(FIREBASE_APPCHECK_KEY), isTokenAutoRefreshEnabled: true });
    appCheckState = "on";
  } catch {
    appCheckState = "failed";
  }
}
export function appCheckStatus(): string {
  return appCheckState;
}

export function getAuthInstance() {
  const fbApp = getFirebaseApp();
  return fbApp ? getAuth(fbApp) : null;
}

export function watchAuth(cb: (user: User | null) => void): () => void {
  const auth = getAuthInstance();
  if (!auth) { cb(null); return () => undefined; }
  return onAuthStateChanged(auth, cb);
}

export type AuthResult = { ok: boolean; user?: User; error?: string };

function authErrorMessage(e: unknown, providerName: string): string {
  const code = (e as { code?: string }).code ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  if (code === "auth/operation-not-allowed") return `${providerName} sign-in is not enabled in Firebase Console → Authentication → Sign-in method. Enable the ${providerName} provider, then try again.`;
  if (code === "auth/unauthorized-domain") return "This domain is not in Firebase Console → Authentication → Settings → Authorized domains. Add this domain, then try again.";
  if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") return "The sign-in window was blocked or closed. Allow popups for this site and try again.";
  if (code === "auth/account-exists-with-different-credential") return "This account is already registered with a different sign-in method. Sign in with that method first.";
  if (code === "auth/network-request-failed") return "Could not reach Firebase. Check the connection and try again.";
  return `${providerName} sign-in failed (${code || "unknown"}): ${msg}`;
}

// Customer sign-in is Google, Facebook and phone ONLY (owner decision,
// 3 Nov 2026). There is no email/password form and no email
// verification step: the Google/Facebook identity or the SMS code is
// the sign-in, and a signed-in customer can order immediately.
export async function loginWithGoogle(): Promise<AuthResult> {
  const auth = getAuthInstance();
  if (!auth) return { ok: false, error: MISSING_CONFIG_BN };
  try {
    await ensureAppCheck();
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    await ensureUserDoc(cred.user);
    return { ok: true, user: cred.user };
  } catch (e) {
    return { ok: false, error: authErrorMessage(e, "Google") };
  }
}

export async function loginWithFacebook(): Promise<AuthResult> {
  const auth = getAuthInstance();
  if (!auth) return { ok: false, error: MISSING_CONFIG_BN };
  try {
    await ensureAppCheck();
    const { FacebookAuthProvider } = await import("firebase/auth");
    const provider = new FacebookAuthProvider();
    provider.addScope("email");
    const cred = await signInWithPopup(auth, provider);
    if (!cred.user.email) return { ok: false, error: "Your Facebook account must share an email address. Check Facebook's email permission, or sign in with Google or phone instead." };
    await ensureUserDoc(cred.user);
    return { ok: true, user: cred.user };
  } catch (e) {
    return { ok: false, error: authErrorMessage(e, "Facebook") };
  }
}

export type PhoneConfirmation = import("firebase/auth").ConfirmationResult;
let recaptchaVerifier: import("firebase/auth").RecaptchaVerifier | null = null;

export async function startPhoneSignIn(phoneNumber: string): Promise<{ ok: boolean; confirmation?: PhoneConfirmation; error?: string }> {
  const auth = getAuthInstance();
  if (!auth) return { ok: false, error: MISSING_CONFIG_BN };
  try {
    await ensureAppCheck();
    const { signInWithPhoneNumber, RecaptchaVerifier } = await import("firebase/auth");
    if (!recaptchaVerifier) recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
    const confirmation = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
    return { ok: true, confirmation };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "auth/operation-not-allowed") return { ok: false, error: "Phone sign-in is not enabled in Firebase Console → Authentication → Sign-in method. Enable the Phone provider, then try again." };
    if (code === "auth/invalid-phone-number") return { ok: false, error: "The phone number is not valid. Use the full number with country code, e.g. +8801XXXXXXXXX." };
    if (code === "auth/too-many-requests") return { ok: false, error: "Too many SMS requests — Firebase is rate-limiting this number for a while. Try again later." };
    return { ok: false, error: `SMS code could not be sent (${code || "unknown"}): ${msg}` };
  }
}

export async function confirmPhoneCode(confirmation: PhoneConfirmation, code: string, name: string): Promise<AuthResult> {
  try {
    const cred = await confirmation.confirm(code);
    await ensureUserDoc(cred.user, name);
    return { ok: true, user: cred.user };
  } catch (e) {
    const codeErr = (e as { code?: string }).code ?? "";
    if (codeErr === "auth/invalid-verification-code") return { ok: false, error: "That SMS code is incorrect. Check the message and try again." };
    if (codeErr === "auth/code-expired") return { ok: false, error: "That SMS code has expired. Request a new code." };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function signOutUser(): Promise<void> {
  const auth = getAuthInstance();
  if (auth) await signOut(auth);
}

// Creates the caller's /users/{uid} document on first sign-in. The role
// is "customer" for everyone except the pinned owner email, which the
// Firestore rules allow to bootstrap as "admin". Staff roles are set
// only by an existing admin in the admin panel (or in the Console).
export async function ensureUserDoc(user: User, name?: string): Promise<void> {
  const firestore = getDb();
  if (!firestore) return;
  const ref = doc(firestore, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  // The users document's `email` field holds the account identifier:
  // the email for Google/Facebook accounts, the phone number for phone
  // accounts (which have no email). The UI shows the phone number for
  // phone accounts, never this field as an email address.
  const email = (user.email ?? user.phoneNumber ?? "").toLowerCase();
  await setDoc(ref, {
    name: name ?? user.displayName ?? email,
    email,
    phone: user.phoneNumber ?? "",
    role: email === OWNER_EMAIL ? "admin" : "customer",
    status: "active",
    loyaltyPoints: 0,
    tier: "Bronze",
    addresses: [],
    wishlist: [],
    createdAt: serverTimestamp(),
  });
}

// Honest connectivity check: reads settings/cafe and reports whether
// Firestore answered, denied (rules not deployed) or is unconfigured.
export async function probeFirestore(): Promise<{ state: string; detail: string }> {
  if (!isFirebaseConfigured) return { state: "not-configured", detail: MISSING_CONFIG_EN };
  const firestore = getDb();
  if (!firestore) return { state: "not-configured", detail: MISSING_CONFIG_EN };
  try {
    const snap = await getDoc(doc(firestore, "settings", "cafe"));
    return snap.exists()
      ? { state: "reachable", detail: "Firestore answered. settings/cafe exists — the customer site is reading live Firestore data." }
      : { state: "reachable", detail: "Firestore answered, but settings/cafe does not exist yet. Press “Seed catalog” in the admin panel to create the catalog and settings." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("permission-denied") || msg.includes("Missing or insufficient permissions")) {
      return { state: "blocked", detail: "Firestore denied the read (Production-mode rules). Deploy firestore.rules with `firebase deploy --only firestore:rules`, then check again." };
    }
    return { state: "blocked", detail: `Firestore error: ${msg}` };
  }
}
