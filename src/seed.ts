// Seed catalog for the standalone Firebase build.
// Source of truth: the Cafe Reza menu in the Hatch artifact's
// server/src/actions.ts (SEED_CATS / SEED_PRODUCTS), copied
// exactly — same 9 categories, same prices. 26 products: the printed
// menu's 25, with Horlicks Tea as two options (small ৳30 / large ৳50)
// because the printed menu shows 30/50.
// Prices of 0 mean "price not set by the owner yet": those items
// stay hidden/unorderable until an admin sets a price in the
// admin panel. This file only WRITES these documents the first
// time an admin presses "Seed catalog" when Firestore is empty;
// it never overwrites prices an admin has changed afterwards.

export type SeedProduct = { slug: string; en: string; bn: string; categoryId: string; price: number; img: string; img2: string; ing: string; feat: boolean; best: boolean; isNew: boolean; avail: boolean; desc: string };

export const SEED_CATEGORIES: Array<{ id: string; nameEn: string; nameBn: string; sortOrder: number; active: boolean }> = [
  { id: "hot-coffee", nameEn: "Hot Coffee", nameBn: "হট কফি", sortOrder: 1, active: true },
  { id: "cold-coffee", nameEn: "Cold Coffee", nameBn: "কোল্ড কফি", sortOrder: 2, active: true },
  { id: "milkshake", nameEn: "Milkshake", nameBn: "মিল্কশেক", sortOrder: 3, active: true },
  { id: "smoothies", nameEn: "Smoothies", nameBn: "স্মুদি", sortOrder: 4, active: true },
  { id: "fresh-juice", nameEn: "Fresh Juice", nameBn: "ফ্রেশ জুস", sortOrder: 5, active: true },
  { id: "desserts", nameEn: "Desserts", nameBn: "ডেজার্ট", sortOrder: 6, active: true },
  { id: "fast-food", nameEn: "Fast Food", nameBn: "ফাস্ট ফুড", sortOrder: 7, active: true },
  { id: "tea", nameEn: "Tea", nameBn: "চা", sortOrder: 8, active: true },
  { id: "mocktails", nameEn: "Mocktails", nameBn: "মকটেল", sortOrder: 9, active: true },
];

export type SeedCoupon = { code: string; kind: string; value: number; minPurchase: number; maxDiscount: number | null; usageLimit: number | null; active: boolean; expiresAt: string; description: string; firstOrderOnly: boolean };

// First-order welcome coupon: 10% off, only on a customer's very
// first order. Seeded like the products — only when the coupon does
// not already exist, so an admin-edited coupon is never overwritten.
export const SEED_COUPONS: SeedCoupon[] = [
  { code: "WELCOME10", kind: "percent", value: 10, minPurchase: 0, maxDiscount: null, usageLimit: null, active: true, expiresAt: "", description: "First order — 10% off", firstOrderOnly: true },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  { slug: "hot-coffee-regular", en: "Hot Coffee (Regular)", bn: "হট কফি (রেগুলার)", categoryId: "hot-coffee", price: 50, img: "poster-hot-coffee.jpg", img2: "poster-hot-coffee.jpg", ing: "Coffee, Milk, Hot water", feat: false, best: false, isNew: false, avail: true, desc: "Classic hot coffee, served fresh at the counter." },
  { slug: "hot-coffee-special", en: "Hot Coffee (Special)", bn: "হট কফি (স্পেশাল)", categoryId: "hot-coffee", price: 80, img: "poster-hot-coffee.jpg", img2: "poster-hot-coffee.jpg", ing: "Coffee, Milk, Hot water", feat: true, best: true, isNew: false, avail: true, desc: "Our special hot coffee — the house favourite." },
  { slug: "choco-cold-coffee", en: "Choco Cold Coffee", bn: "চকো কোল্ড কফি", categoryId: "cold-coffee", price: 80, img: "poster-choco.jpg", img2: "poster-choco.jpg", ing: "Coffee, Chocolate, Milk, Ice", feat: true, best: false, isNew: false, avail: true, desc: "Chilled chocolate coffee, served cold." },
  { slug: "caramel-cold-coffee", en: "Caramel Cold Coffee", bn: "ক্যারামেল কোল্ড কফি", categoryId: "cold-coffee", price: 80, img: "poster-caramel.jpg", img2: "poster-caramel.jpg", ing: "Coffee, Caramel, Milk, Ice", feat: false, best: false, isNew: false, avail: true, desc: "Chilled caramel coffee, served cold." },
  { slug: "special-cold-coffee", en: "Special Cold Coffee", bn: "স্পেশাল কোল্ড কফি", categoryId: "cold-coffee", price: 200, img: "poster-special-cold.jpg", img2: "poster-special-cold.jpg", ing: "Coffee, Milk, Ice", feat: true, best: false, isNew: false, avail: true, desc: "Our special cold coffee." },
  { slug: "oreo-milkshake", en: "Oreo Milkshake", bn: "ওরিও মিল্কশেক", categoryId: "milkshake", price: 100, img: "poster-oreo.jpg", img2: "poster-oreo.jpg", ing: "Oreo cookies, Milk, Ice, Cream", feat: false, best: true, isNew: false, avail: true, desc: "Thick Oreo milkshake." },
  { slug: "kitkat-milkshake", en: "Kitkat Milkshake", bn: "কিটক্যাট মিল্কশেক", categoryId: "milkshake", price: 100, img: "poster-kitkat.jpg", img2: "poster-kitkat.jpg", ing: "KitKat, Milk, Ice, Cream", feat: false, best: false, isNew: false, avail: true, desc: "Thick Kitkat milkshake." },
  { slug: "strawberry-milkshake", en: "Strawberry Milkshake", bn: "স্ট্রবেরি মিল্কশেক", categoryId: "milkshake", price: 140, img: "poster-strawberry.jpg", img2: "poster-strawberry.jpg", ing: "Strawberry, Milk, Ice", feat: false, best: false, isNew: false, avail: true, desc: "Strawberry milkshake." },
  { slug: "coconut-smoothie", en: "Coconut Smoothie", bn: "কোকোনাট স্মুদি", categoryId: "smoothies", price: 60, img: "poster-coconut.jpg", img2: "poster-coconut.jpg", ing: "Coconut, Milk, Ice", feat: false, best: false, isNew: false, avail: true, desc: "Cool, creamy coconut smoothie." },
  { slug: "pineapple-juice", en: "Pineapple Juice", bn: "আনারসের জুস", categoryId: "fresh-juice", price: 40, img: "poster-pineapple.jpg", img2: "poster-pineapple.jpg", ing: "Pineapple, Ice, Water", feat: false, best: false, isNew: false, avail: true, desc: "Fresh pineapple juice." },
  { slug: "mixed-fruit-juice", en: "Mixed Fruit Juice", bn: "মিক্সড ফ্রুট জুস", categoryId: "fresh-juice", price: 80, img: "main-mixed-fruit-juice.png", img2: "main-mixed-fruit-juice.png", ing: "Mixed fruits, Ice, Water", feat: false, best: false, isNew: false, avail: true, desc: "Mixed fresh fruit juice." },
  { slug: "special-faluda", en: "Special Faluda", bn: "স্পেশাল ফালুদা", categoryId: "desserts", price: 150, img: "poster-faluda.jpg", img2: "poster-faluda-red.jpg", ing: "Milk, Ice cream, Vermicelli, Basil seeds, Jelly, Fruits", feat: true, best: true, isNew: false, avail: true, desc: "Cafe Reza's signature special faluda." },
  { slug: "doi-chira", en: "Doi-Chira", bn: "দই-চিড়া", categoryId: "desserts", price: 60, img: "poster-doi-chira.jpg", img2: "tray.jpg", ing: "Curd, Flattened rice, Banana, Coconut, Fruits, Basil seeds", feat: false, best: false, isNew: false, avail: true, desc: "Curd with flattened rice — a light, traditional favourite." },
  { slug: "special-doi-chira", en: "Special Doi-Chira", bn: "স্পেশাল দই-চিড়া", categoryId: "desserts", price: 100, img: "poster-doi-chira-special.jpg", img2: "tray.jpg", ing: "Curd, Flattened rice, Banana, Coconut, Fruits, Basil seeds", feat: false, best: false, isNew: false, avail: true, desc: "The special version of our doi-chira." },
  { slug: "chicken-momo-5pc", en: "Chicken Momo (5 pcs)", bn: "চিকেন মোমো (৫ পিস)", categoryId: "fast-food", price: 80, img: "poster-momo.jpg", img2: "tray2.jpg", ing: "Chicken, Onion, Spices, Flour wrapper, Dipping sauce", feat: false, best: true, isNew: false, avail: true, desc: "Steamed chicken momo, five pieces per plate." },
  { slug: "naga-momo", en: "Naga Momo (5 pcs)", bn: "নাগা মোমো (৫ পিস)", categoryId: "fast-food", price: 90, img: "poster-momo-naga.jpg", img2: "tray2.jpg", ing: "Chicken, Naga chilli, Spices, Flour wrapper, Dipping sauce", feat: false, best: false, isNew: true, avail: true, desc: "Spicy naga-style steamed momo, five pieces, served with special sauce." },
  { slug: "regular-milk-tea", en: "Regular Milk Tea", bn: "রেগুলার দুধ চা", categoryId: "tea", price: 40, img: "poster-milk-tea.jpg", img2: "poster-milk-tea.jpg", ing: "Tea, Milk, Sugar, Water", feat: false, best: false, isNew: false, avail: true, desc: "Regular milk tea." },
  { slug: "malai-tea", en: "Malai Tea", bn: "মালাই চা", categoryId: "tea", price: 50, img: "poster-malai.jpg", img2: "poster-malai.jpg", ing: "Tea, Milk, Malai, Sugar", feat: false, best: false, isNew: false, avail: true, desc: "Rich malai tea." },
  { slug: "energy-booster", en: "Energy Booster", bn: "এনার্জি বুস্টার", categoryId: "fresh-juice", price: 100, img: "poster-energy.jpg", img2: "poster-energy-detail.jpg", ing: "Banana, Dates, Honey, Almonds, Raisins, Cashews, Milk", feat: false, best: false, isNew: true, avail: true, desc: "Our energy booster drink." },
  { slug: "yogurd-lacchi", en: "Yogurt Lassi", bn: "দইয়ের লাচ্ছি", categoryId: "smoothies", price: 60, img: "poster-lacchi.jpg", img2: "tray.jpg", ing: "Yoghurt, Milk, Sugar, Ice", feat: false, best: false, isNew: false, avail: true, desc: "Chilled yogurt lassi." },
  { slug: "horlicks-tea-small", en: "Horlicks Tea (Small)", bn: "হরলিক্স চা (ছোট)", categoryId: "tea", price: 30, img: "main-horlicks-tea.png", img2: "main-horlicks-tea.png", ing: "Horlicks, Milk, Tea", feat: false, best: false, isNew: false, avail: true, desc: "Horlicks tea with milk, small." },
  { slug: "horlicks-tea-large", en: "Horlicks Tea (Large)", bn: "হরলিক্স চা (বড়)", categoryId: "tea", price: 50, img: "main-horlicks-tea.png", img2: "main-horlicks-tea.png", ing: "Horlicks, Milk, Tea", feat: false, best: false, isNew: false, avail: true, desc: "Horlicks tea with milk, large." },
  { slug: "edible-cup-tea", en: "Edible Cup Tea", bn: "এডিবল কাপ চা", categoryId: "tea", price: 50, img: "main-edible-cup-tea.png", img2: "main-edible-cup-tea.png", ing: "Tea, Milk, Edible cup", feat: false, best: false, isNew: false, avail: true, desc: "Tea served in an edible cup." },
  { slug: "cold-tea", en: "Cold Tea", bn: "কোল্ড চা", categoryId: "cold-coffee", price: 80, img: "poster-cold-tea.jpg", img2: "poster-cold-tea.jpg", ing: "Tea, Ice, Water, Sugar", feat: false, best: false, isNew: false, avail: true, desc: "Chilled cold tea." },
  { slug: "iced-mint-lemonade-half", en: "Iced Mint Lemonade (Half)", bn: "আইসড মিন্ট লেমনেড (হাফ)", categoryId: "fresh-juice", price: 60, img: "poster-lemonade-half.jpg", img2: "poster-lemonade-half.jpg", ing: "Mint, Lemon, Ice, Sugar, Water", feat: false, best: false, isNew: true, avail: true, desc: "Iced mint lemonade, half size." },
  { slug: "iced-mint-lemonade-full", en: "Iced Mint Lemonade (Full)", bn: "আইসড মিন্ট লেমনেড (ফুল)", categoryId: "fresh-juice", price: 120, img: "poster-lemonade-full.jpg", img2: "poster-lemonade-full.jpg", ing: "Mint, Lemon, Ice, Sugar, Water", feat: false, best: false, isNew: true, avail: true, desc: "Iced mint lemonade, full size." },
];

export const DEFAULT_SETTINGS = {
  cafeName: "Café Reza",
  tagline: "Dedicated to serving you through fresh, healthy and tasty food",
  taglineBn: "তাজা, স্বাস্থ্যকর ও সুস্বাদু খাবার পরিবেশনের মাধ্যমে আপনাদের সেবায় নিয়োজিত",
  address: "Dhulipara Chawmuhani, EPZ road, Comilla, Bangladesh",
  phone: "+880 1805-501689",
  email: "",
  facebook: "https://www.facebook.com/cafereza4u",
  hours: "",
  vatPercent: 0,
  deliveryFee: 40,
  freeDeliveryAt: 500,
  minOrder: 0,
  bkashNumber: "",
  nagadNumber: "",
  rocketNumber: "",
  paymentNote: "",
  adsJson: "[]",
  hoursJson: "",
  zonesJson: "[]",
  paymentsJson: "",
  contentJson: JSON.stringify({ announcement: "", aboutText: "", showGallery: true }),
  promoVideo: "main",
  bannersJson: "[]",
  loyaltyPerAmount: 100,
  loyaltyRedeemPoints: 100,
  loyaltyRedeemValue: 10,
  // Offer controls (owner's decisions — changeable in Admin → Settings):
  // combo: 4+ of one item → ৳10 off; happy hour 16:00–18:00 → 2% off;
  // a customer may cancel an order only within 2 minutes of placing it.
  comboMinQty: 4,
  comboDiscount: 10,
  happyHourStart: "16:00",
  happyHourEnd: "18:00",
  happyHourPercent: 2,
  cancelWindowMinutes: 2,
  riskCautionPct: 25,
  riskRiskyPct: 50,
  geminiApiKey: "",
};

export const BANNER_SLIDES: Array<{ slug: string; img: string; alt: string }> = [
  { slug: "coconut-smoothie", img: "banner-coconut.jpg", alt: "Coconut Smoothie — Café Reza poster" },
  { slug: "special-faluda", img: "banner-faluda.jpg", alt: "Special Faluda — Café Reza poster" },
  { slug: "pineapple-juice", img: "banner-pineapple.jpg", alt: "Pineapple Juice — Café Reza poster" },
];

// Pinned accounts from the cafe's own records (same pinning as the
// Hatch build): the owner email is the Super Admin, the customer
// email stays an ordinary customer. Firestore rules enforce both.
export const OWNER_EMAIL = "rezamdyeasin@gmail.com";
export const CUSTOMER_EMAIL = "yeasinreza81@gmail.com";

export const MAP_COORDS = { lat: 23.44981, lon: 91.19012, plusCode: "C5XR+W2H Cumilla" };
export const MAPS_LINK = "https://goo.gl/maps/iPaXfgRejF3aaPr1A";

