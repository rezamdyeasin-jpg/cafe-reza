# Café Reza — Firebase-এ লাইভ করার ধাপ (বাংলা)

এই রিপোজিটরিটাই আসল সাইট: কাস্টমার প্যানেল + অ্যাডমিন প্যানেল একই অ্যাপ,
Firestore-ই আসল ডেটাবেস। লগইন শুধু **Google, Facebook ও ফোন নম্বর** দিয়ে —
কোনো ইমেইল ভেরিফিকেশন ধাপ নেই।

## লঞ্চের ক্রম (অবশ্যই এই ক্রমে)

1. **আগে অ্যাডমিন প্যানেল লাইভ** করুন, `#/admin`-এ সাইন-ইন করে ড্যাশবোর্ড
   যাচাই করুন, তারপর অ্যাডমিন লিংক শেয়ার করুন।
2. **তারপর কাস্টমার সাইট** (`#/`) প্রকাশ করুন — অর্ডার ও মার্কেটিংয়ের লিংক।

## ১. GitHub-এ আপলোড

```bash
cd cafe-reza-firebase
git init
git add .
git commit -m "Cafe Reza Firebase build"
git remote add origin https://github.com/rezamdyeasin-jpg/cafe-reza-firebase.git
git push -u origin main
```

⚠️ `.env` ফাইল কখনো GitHub-এ তুলবেন না। এই রিপোতে কোনো API key নেই —
`.env.example`-এ শুধু নামগুলো আছে।

## ২. Firebase Console-এ যা চালু করতে হবে (প্রজেক্ট: cafe-reza)

1. **Authentication → Sign-in method:** Google ✅, Facebook ✅, Phone ✅ চালু করুন।
   - Facebook-এর জন্য Meta for Developers-এ অ্যাপ বানিয়ে App ID/Secret বসাতে হবে।
   - Phone-এর জন্য reCAPTCHA স্বয়ংক্রিয়ভাবে চলে (কোড আলাদা কিছু লাগে না)।
2. **Authentication → Settings → Authorized domains:** আপনার Hosting ডোমেইন
   (যেমন `cafe-reza.web.app`) যোগ করুন। না যোগ করলে Google/Facebook পপআপ বন্ধ হবে।
3. **Project settings → Your apps → "Cafe Reza Web":** ওখান থেকে মানগুলো নিয়ে
   `.env` ফাইল বানান (নিচে দেখুন)।

## ৩. লোকালে `.env` বানান (মানগুলো Console থেকে নিন, এখানে লিখবেন না)

```bash
cp .env.example .env
# তারপর .env খুলে প্রতিটি মান বসান
```

| নাম | কোথা থেকে |
|---|---|
| `VITE_FIREBASE_API_KEY` | Console → Project settings → Your apps → Web app → apiKey |
| `VITE_FIREBASE_AUTH_DOMAIN` | একই জায়গায় authDomain (`cafe-reza.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | `cafe-reza` |
| `VITE_FIREBASE_STORAGE_BUCKET` | একই জায়গায় storageBucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | একই জায়গায় messagingSenderId |
| `VITE_FIREBASE_APP_ID` | একই জায়গায় appId |
| `VITE_FIREBASE_APPCHECK_KEY` | (ঐচ্ছিক) App Check → reCAPTCHA v3 site key |

## ৪. বিল্ড ও ডেপ্লয়

```bash
npm install
npm run build
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,storage,hosting
```

ডেপ্লয় শেষে লিংক আসবে — যেমন `https://cafe-reza.web.app`।

## ৫. প্রথম অ্যাডমিন সাইন-ইন ও ক্যাটালগ

1. `https://cafe-reza.web.app/#/admin` খুলুন।
2. মালিকের ইমেইল `rezamdyeasin@gmail.com` দিয়ে Google-এ সাইন-ইন করুন —
   প্রথম সাইন-ইনেই অ্যাকাউন্টটি স্বয়ংক্রিয়ভাবে **admin** হয়ে যাবে।
3. **Firebase & Launch** ট্যাবে **Check Firestore connection** চাপুন (লাইভ যাচাই)।
4. একই ট্যাবে **Seed catalog** চাপুন — ৩৪টি প্রোডাক্ট ও ৯টি ক্যাটাগরি
   (ছাপা মেনুর দামসহ) Firestore-এ বসবে। শুধু খালি জায়গায় লেখে;
   অ্যাডমিনের বদলানো দাম/স্টক কখনো ওভাররাইট করে না।
5. কাস্টমার প্যানেলে মেনু দেখা যাচ্ছে কি না যাচাই করুন।

## ৬. অ্যাডমিন প্যানেল থেকে যা যা নিয়ন্ত্রণ করা যায়

কাস্টমার সাইটের সবকিছু Firestore থেকে লাইভ পড়ে — অ্যাডমিন প্যানেলে বদলালেই
কাস্টমার প্যানেল সাথে সাথে বদলে যায়, আলাদা কোনো কপি নেই:

- **Products & Categories** — প্রোডাক্ট যোগ/সম্পাদনা/মুছুন, দাম, স্টক,
  ছবি, উপকরণ; ক্যাটাগরি যোগ/মুছুন।
- **Orders / Kitchen** — অর্ডারের অবস্থা, মোবাইল পেমেন্ট ম্যানুয়াল যাচাই,
  ফেরতের অনুরোধ ও সিদ্ধান্ত।
- **POS** — কাউন্টারে নগদ বিক্রি, খুচরা হিসাবসহ।
- **Tables & Reservations** — টেবিল ও রিজার্ভেশন পরিচালনা।
- **Coupons & Offers** — কুপন/অফার, যা চেকআউটে কাজ করে।
- **Content & Banners** — ঘোষণা বার, About লেখা, গ্যালারি, প্রোমো ভিডিও,
  ব্যানার ক্যারোসেল, বিজ্ঞাপনের জায়গা।
- **Settings** — ক্যাফের তথ্য, VAT, ডেলিভারি ফি/জোন, পেমেন্ট মাধ্যম
  (bKash/Nagad/Rocket নম্বর), লয়্যালটি।
- **Users & Staff** — স্টাফ রোল ও সাসপেন্ড। মালিক সবসময় admin, নির্দিষ্ট
  কাস্টমার অ্যাকাউন্ট সবসময় customer — রোল বদলানো যায় না।
- **Support & Reviews** — মেসেজের জবাব, টিকিট, রিভিউ অনুমোদন।
- **Inventory** — স্টক, কম-স্টক সতর্কতা।
- **Firebase & Launch** — সংযোগ যাচাই, ক্যাটালগ সিড, লঞ্চের ধাপ।

## নিরাপত্তার কথা

- **আগে প্রকাশ হওয়া web API key-টি Firebase Console-এ রোটেট/সীমাবদ্ধ করুন**
  (API restrictions → শুধু Firebase Auth/Firestore/Storage)। এই রিপোতে কোনো
  key নেই, তবু পুরনো key-টি বদলানো জরুরি।
- Firestore rules (`firestore.rules`) ডিফল্টে সব বন্ধ রাখে: প্রোডাক্ট/ক্যাটাগরি/
  সেটিংস সবাই পড়তে পারে, লিখতে পারে শুধু স্টাফ; অর্ডার দেখে শুধু মালিক ও
  স্টাফ; কাস্টমার নিজের অর্ডারই বানাতে পারে, বানানোর পর দাম/আইটেম বদলাতে
  পারে না; পেমেন্ট "Paid" করতে পারে শুধু ম্যানেজার/অ্যাডমিন।
- মোবাইল পেমেন্ট কখনো স্বয়ংক্রিয়ভাবে Paid হয় না — মালিক/ম্যানেজার যাচাই
  করে "Verify payment" চাপলে তবেই Paid হয়।

## দাম না-জানা আইটেম

যেসব আইটেমের দাম মালিক এখনো বসাননি (দাম ০), সেগুলো মেনুতে "দাম বসানো
হয়নি" হিসেবে দেখায় এবং অর্ডার করা যায় না। অ্যাডমিন প্যানেলে দাম বসালেই
অর্ডার চালু হয়ে যাবে — কোনো দাম অনুমান করে বসানো হয়নি।

## সমস্যা হলে

- সাইট খুলে "Firebase is not configured" দেখালে `.env`-এর মানগুলো বসানো হয়নি
  বা বিল্ডের সময় env var পৌঁছায়নি — `.env` বসিয়ে আবার `npm run build` করুন।
- "Permission denied" দেখালে rules ডেপ্লয় হয়নি — ধাপ ৪-এর কমান্ড আবার চালান।
- Google পপআপ বন্ধ হলে Authorized domains-এ ডোমেইন যোগ করা হয়নি (ধাপ ২.২)।
