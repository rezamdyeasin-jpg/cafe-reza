# Environment variables — Café Reza (names only, NO values)

এই ফাইলে শুধু **নাম** আছে — কোনো মান (key/secret) নেই। মান বসে শুধু
হোস্টিং প্রোভাইডারের Environment Variables / Secret সেটিংসে
(Vercel: Project → Settings → Environment Variables, Production)।
কোনো মান কখনো কোডে, `.env.example`-এ, GitHub-এ বা চ্যাটে লিখবেন না।
মান বসানো/বদলানোর পর Vercel-এ **Redeploy** করতে হয় — নতুন ডেপ্লয়
ছাড়া env কার্যকর হয় না।

ভিডিও (মালিকের পাঠানো): https://youtu.be/EgJ3HZvCbMI?si=Qh-U9e_aVYIk8wsz
পুরো ধাপ: DEPLOY.md। Firebase প্রজেক্ট: `cafe-reza` (Spark, ফ্রি)।

## ১. Firebase — বাধ্যতামূলক (Google সাইন-ইন ও যাচাই মেইলের জন্য)

মান নিতে হবে: Firebase Console → Project settings → Your apps →
"Cafe Reza Web" থেকে। সার্ভার `FIREBASE_*` নাম আগে দেখে, না পেলে
`VITE_FIREBASE_*` নাম দেখে — দুই নামের একটিতেই চলবে, তবে Vercel-এ
`FIREBASE_*` নামগুলোই বসান (DEPLOY.md-এর সাথে মিলিয়ে)।

| নাম | বাধ্যতামূলক? | কোথা থেকে নেবেন |
|---|---|---|
| `FIREBASE_API_KEY` | হ্যাঁ | Firebase Console → Project settings → Your apps → "Cafe Reza Web" → Web API Key |
| `FIREBASE_PROJECT_ID` | হ্যাঁ | একই জায়গা — মান: `cafe-reza` |
| `FIREBASE_APP_ID` | হ্যাঁ | একই জায়গা — App ID |
| `FIREBASE_AUTH_DOMAIN` | ঐচ্ছিক | একই জায়গা — না দিলে `cafe-reza.firebaseapp.com` ধরা হয় |
| `FIREBASE_STORAGE_BUCKET` | ঐচ্ছিক | একই জায়গা |
| `FIREBASE_MESSAGING_SENDER_ID` | ঐচ্ছিক | একই জায়গা — প্রজেক্ট নম্বর |
| `FIREBASE_MEASUREMENT_ID` | ঐচ্ছিক | একই জায়গা — Analytics বন্ধ থাকলে লাগে না |
| `VITE_FIREBASE_APPCHECK_KEY` | শুধু App Check চালু করলে | Firebase Console → App Check → reCAPTCHA Enterprise site key |

**না বসালে যা হবে:** Firebase Auth চালু হবে না; অ্যাপ সৎভাবে
"Firebase কনফিগার করা হয়নি" জানাবে, কোনো যাচাই মেইল পাঠানো হবে না,
আর সাইট চলবে নিজের সার্ভার অ্যাকশন + ডেটাবেসে (Demo Mode)।

**আগে প্রকাশিত key:** আগের কোনো ওয়েব API key কোথাও প্রকাশ হয়ে
থাকলে Firebase Console → Project settings থেকে সেটি **রোটেট/সীমিত
(restrict)** করুন — এই ধাপটি বাকি আছে। নতুন key বসালেও পুরোনোটি
ঘুরিয়ে না নিলে ঝুঁকি থেকে যায়।

## ২. সাইটের ঠিকানা — ঐচ্ছিক

| নাম | বাধ্যতামূলক? | কাজ |
|---|---|---|
| `VITE_APP_URL` | না | খালি রাখলেই চলে — অ্যাপ শুধু relative URL ব্যবহার করে। Absolute URL দরকার হলে (যেমন ইমেইলে) এখানে ডেপ্লয়ের ঠিকানা বসান। |

## ৩. ইমেইল (OTP কোড) — ঐচ্ছিক, Resend থাকলে

| নাম | বাধ্যতামূলক? | কোথা থেকে নেবেন |
|---|---|---|
| `RESEND_API_KEY` | OTP মেইল চাইলে | Resend অ্যাকাউন্ট → API Keys |
| `RESEND_FROM` | OTP মেইল চাইলে | Resend-এ ভেরিফাই করা sender ইমেইল/ডোমেইন |

**না বসালে যা হবে:** OTP কোড পাঠানো হবে না; অ্যাপ সৎভাবে জানাবে
কোনো মেইল যায়নি, কোনো কোড বানিয়ে দেখানো হবে না। Firebase-এর
যাচাই মেইল (১ নম্বর ধাপের key দিয়ে) আলাদা পথ — সেটির জন্য Resend
লাগে না। এই দুটি নামে কখনো `VITE_` বসাবেন না — এগুলো সার্ভার-শুধু।

## ৪. পেমেন্ট গেটওয়ে — এখন বসাবেন না

bKash / Nagad / SSLCommerz-এর কোনো merchant key/secret এই সাইটে
বসানো নেই, আর Demo Mode যাচাই শেষ না হওয়া পর্যন্ত বসাতেও হবে না।
মোবাইল পেমেন্ট এখন ম্যানুয়াল যাচাইয়ে "Pending verification" থাকে —
কখনো স্বয়ংক্রিয়ভাবে Paid ধরা হয় না। গেটওয়ে সংযুক্ত হলে তার
নামগুলো README-এর "Going live" ধাপে যোগ হবে; ততদিন এই অংশ খালি
থাকাই সঠিক।

## যাচাই-তালিকা (env বসানোর পর)

1. Vercel-এ Redeploy হয়েছে।
2. Firebase Console → Authentication → Settings → Authorized domains-এ
   Vercel সাবডোমেইন যোগ হয়েছে।
3. Admin → Security → "Check Firebase connection"-এ config complete
   দেখায়।
4. নতুন কাস্টমার অ্যাকাউন্টে Firebase যাচাই মেইল আসে, আর লিংকে
   ক্লিকের পর "লিংকে ক্লিক করেছি" বোতামে যাচাই শেষ হয়।
