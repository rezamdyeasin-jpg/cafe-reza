DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', status TEXT NOT NULL DEFAULT 'active', loyalty_points INTEGER NOT NULL DEFAULT 0, tier TEXT NOT NULL DEFAULT 'Bronze', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name_en TEXT NOT NULL, name_bn TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
--> statement-breakpoint
CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name_en TEXT NOT NULL, name_bn TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category_id INTEGER NOT NULL, price INTEGER NOT NULL, discount_price INTEGER, cost_price INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 100, available INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0, best_seller INTEGER NOT NULL DEFAULT 0, is_new INTEGER NOT NULL DEFAULT 0, prep_time INTEGER NOT NULL DEFAULT 10, image_key TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'percent', value INTEGER NOT NULL DEFAULT 0, min_purchase INTEGER NOT NULL DEFAULT 0, max_discount INTEGER, usage_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, expires_at TEXT, description TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, user_id INTEGER, customer_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', order_type TEXT NOT NULL DEFAULT 'delivery', source TEXT NOT NULL DEFAULT 'website', status TEXT NOT NULL DEFAULT 'Pending', payment_method TEXT NOT NULL DEFAULT 'Cash on Delivery', payment_status TEXT NOT NULL DEFAULT 'Unpaid', payment_ref TEXT NOT NULL DEFAULT '', subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, vat INTEGER NOT NULL DEFAULT 0, delivery_fee INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, paid_amount INTEGER NOT NULL DEFAULT 0, change_amount INTEGER NOT NULL DEFAULT 0, table_label TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', staff_name TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]', history_json TEXT NOT NULL DEFAULT '[]', coupon_code TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE tables_tbl (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 4, status TEXT NOT NULL DEFAULT 'Available', notes TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, time TEXT NOT NULL, guests INTEGER NOT NULL DEFAULT 2, requests TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Pending', table_label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other ingredients', unit TEXT NOT NULL DEFAULT 'kg', quantity REAL NOT NULL DEFAULT 0, low_at REAL NOT NULL DEFAULT 1, cost_per_unit INTEGER NOT NULL DEFAULT 0, expiry TEXT NOT NULL DEFAULT '', supplier TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE stock_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, kind TEXT NOT NULL, qty REAL NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', item TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, date TEXT NOT NULL, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, author TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 5, comment TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Approved', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'General', priority TEXT NOT NULL DEFAULT 'Normal', status TEXT NOT NULL DEFAULT 'Open', message TEXT NOT NULL DEFAULT '', reply TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'order', read_flag INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, label TEXT NOT NULL DEFAULT 'Home', address TEXT NOT NULL, area TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE wishlist (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, UNIQUE(user_id, product_id));
--> statement-breakpoint
CREATE TABLE loyalty_tx (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, points INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, cashier TEXT NOT NULL, opening_cash INTEGER NOT NULL DEFAULT 0, closing_cash INTEGER, status TEXT NOT NULL DEFAULT 'Open', opened_at INTEGER NOT NULL, closed_at INTEGER);
--> statement-breakpoint
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), cafe_name TEXT NOT NULL DEFAULT 'Cafe Reza', tagline TEXT NOT NULL DEFAULT 'Premium coffee, faluda & momo — made fresh in Cumilla.', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', facebook TEXT NOT NULL DEFAULT 'https://www.facebook.com/cafereza4u', hours TEXT NOT NULL DEFAULT '', vat_percent INTEGER NOT NULL DEFAULT 0, delivery_fee INTEGER NOT NULL DEFAULT 40, free_delivery_at INTEGER NOT NULL DEFAULT 500, min_order INTEGER NOT NULL DEFAULT 0, demo_mode INTEGER NOT NULL DEFAULT 1, bkash_number TEXT NOT NULL DEFAULT '', nagad_number TEXT NOT NULL DEFAULT '', rocket_number TEXT NOT NULL DEFAULT '', payment_note TEXT NOT NULL DEFAULT 'Demo Mode: no real payment gateway is connected. Mobile-banking payments stay Pending verification until the owner verifies them manually.');
--> statement-breakpoint
INSERT INTO settings (id) VALUES (1);
--> statement-breakpoint
INSERT INTO tables_tbl (label, capacity, status) VALUES ('T1', 2, 'Available'), ('T2', 2, 'Available'), ('T3', 4, 'Available'), ('T4', 4, 'Available'), ('T5', 6, 'Available'), ('T6', 8, 'Available');
