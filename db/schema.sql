-- 超市 web 后端 D1 schema（替代原 CloudBase 文档库集合）
-- 字段中的数组/对象以 JSON 文本存储。

CREATE TABLE IF NOT EXISTS categories (
  _id           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT '',
  "order"       INTEGER DEFAULT 0,
  subcategories TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS products (
  _id           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  spec          TEXT DEFAULT '',
  price         REAL DEFAULT 0,
  costPrice     REAL DEFAULT 0,
  subcategories TEXT DEFAULT '[]',
  enabled       INTEGER DEFAULT 1,
  "order"       INTEGER DEFAULT 0,
  image         TEXT DEFAULT '',
  images        TEXT DEFAULT '[]',
  description   TEXT DEFAULT '',
  reviews       TEXT DEFAULT '[]',
  createdAt     TEXT,
  updatedAt     TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  _id               TEXT PRIMARY KEY,
  roomNumber        TEXT DEFAULT '',
  items             TEXT DEFAULT '[]',
  totalAmount       REAL DEFAULT 0,
  status            TEXT DEFAULT 'pending',
  wechat            TEXT DEFAULT '',
  remark            TEXT DEFAULT '',
  paymentScreenshot TEXT DEFAULT '',
  createdAt         TEXT,
  updatedAt         TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  _id           TEXT PRIMARY KEY,
  productOrder  INTEGER,
  "user"        TEXT DEFAULT '匿名用户',
  rating        INTEGER DEFAULT 5,
  text          TEXT DEFAULT '',
  images        TEXT DEFAULT '[]',
  createdAt     TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
  _id           TEXT PRIMARY KEY,
  serviceId     TEXT DEFAULT '',
  serviceName   TEXT DEFAULT '',
  categoryId    TEXT DEFAULT '',
  categoryName  TEXT DEFAULT '',
  formData      TEXT DEFAULT '{}',
  images        TEXT DEFAULT '[]',
  status        TEXT DEFAULT 'pending',
  createdAt     TEXT,
  updatedAt     TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_productOrder ON reviews (productOrder);
CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders (createdAt);
CREATE INDEX IF NOT EXISTS idx_products_order ON products ("order");
CREATE INDEX IF NOT EXISTS idx_submissions_createdAt ON submissions (createdAt);
