import { createHash, randomBytes } from "node:crypto";
import {
definePrivilegedContracts,
definePrivilegedHandlers,
z,
} from "@hatch/space-sdk";

// Host-only crypto helpers (SHA-256 password hashing and secure random
// tokens). Action code must never import node:crypto directly: it imports
// the descriptor from "@space/privileged" and calls ctx.executePrivileged.
export const privileged = definePrivilegedContracts({
  cryptoOps: {
    request: z.object({
      op: z.enum(["hash", "random"]),
      salt: z.string().default(""),
      password: z.string().default(""),
      bytes: z.number().int().min(1).max(64).default(32),
    }),
    response: z.object({ value: z.string() }),
    timeoutMs: 10000,
  },
  // Host-only email sending. Credentials come only from the host
  // environment (RESEND_API_KEY / RESEND_FROM); with none configured it
  // reports sent:false and nothing is faked. Action code must never read
  // process.env or call the provider directly.
  sendEmail: {
    request: z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      text: z.string().min(1),
    }),
    response: z.object({ sent: z.boolean(), detail: z.string() }),
    timeoutMs: 15000,
  },
  // Host-only Firebase web config. Values come only from the hosting
  // environment (FIREBASE_API_KEY / FIREBASE_AUTH_DOMAIN / ...); with
  // none configured it reports configured:false and nothing is baked
  // into shipped source. The client fetches this at runtime before
  // initializing Firebase Auth.
  firebaseConfig: {
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      apiKey: z.string(),
      authDomain: z.string(),
      projectId: z.string(),
      storageBucket: z.string(),
      messagingSenderId: z.string(),
      appId: z.string(),
      measurementId: z.string(),
    }),
    timeoutMs: 5000,
  },
});

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  cryptoOps(args) {
    if (args.op === "hash") {
      return {
        value: createHash("sha256")
          .update(`${args.salt}:${args.password}`)
          .digest("hex"),
      };
    }
    return { value: randomBytes(args.bytes).toString("hex") };
  },
  async sendEmail(args) {
    const key = process.env.RESEND_API_KEY ?? "";
    const from = process.env.RESEND_FROM ?? "";
    if (!key || !from) {
      return { sent: false, detail: "No email provider is configured (RESEND_API_KEY / RESEND_FROM are not set in the hosting environment)." };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [args.to],
          subject: args.subject,
          text: args.text,
        }),
      });
      if (!res.ok) {
        return { sent: false, detail: "The email provider rejected the message. Check the provider key and verified sender address." };
      }
      return { sent: true, detail: "Verification code sent." };
    } catch {
      return { sent: false, detail: "Could not reach the email provider. Check the connection and try again." };
    }
  },
  firebaseConfig() {
    const pick = (key: string, viteKey: string) => (process.env[key] ?? process.env[viteKey] ?? "").trim();
    const apiKey = pick("FIREBASE_API_KEY", "VITE_FIREBASE_API_KEY");
    const projectId = pick("FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID");
    const appId = pick("FIREBASE_APP_ID", "VITE_FIREBASE_APP_ID");
    return {
      configured: Boolean(apiKey && projectId && appId),
      apiKey,
      authDomain: pick("FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_AUTH_DOMAIN"),
      projectId,
      storageBucket: pick("FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_STORAGE_BUCKET"),
      messagingSenderId: pick("FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_MESSAGING_SENDER_ID"),
      appId,
      measurementId: pick("FIREBASE_MEASUREMENT_ID", "VITE_FIREBASE_MEASUREMENT_ID"),
    };
  },
});
