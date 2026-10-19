-- m.boutiquehomes schema (MySQL 8+, utf8mb4 so Chinese text is stored correctly)

CREATE TABLE IF NOT EXISTS properties (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title_zh       VARCHAR(255) NOT NULL,
  title_en       VARCHAR(255) NOT NULL DEFAULT '',
  type           ENUM('rent','sale') NOT NULL,
  price_rm       BIGINT UNSIGNED NOT NULL,
  area_sqft      INT UNSIGNED NOT NULL,
  beds_zh        VARCHAR(100) NOT NULL,
  beds_en        VARCHAR(100) NOT NULL DEFAULT '',
  bedrooms       VARCHAR(10)  NULL,
  bathrooms      VARCHAR(10)  NULL,
  area           VARCHAR(50)  NOT NULL,
  location_zh    VARCHAR(100) NOT NULL DEFAULT '',
  location_en    VARCHAR(100) NOT NULL DEFAULT '',
  address        VARCHAR(255) NOT NULL DEFAULT '',
  img            VARCHAR(600) NOT NULL,
  status_zh      VARCHAR(255) NOT NULL DEFAULT '',
  status_en      VARCHAR(255) NOT NULL DEFAULT '',
  description_zh TEXT NULL,
  description_en TEXT NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_properties_sort (sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  role_zh    VARCHAR(160) NOT NULL,
  role_en    VARCHAR(160) NOT NULL DEFAULT '',
  meta_zh    VARCHAR(255) NOT NULL DEFAULT '',
  meta_en    VARCHAR(255) NOT NULL DEFAULT '',
  img        VARCHAR(600) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_team_sort (sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  `key`  VARCHAR(50) NOT NULL PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin accounts: each person signs in with their own 6-digit passcode (stored only as a bcrypt hash).
CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(60)  NOT NULL,
  passcode_hash VARCHAR(100) NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  is_owner      TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scheduled hero banners: which picture the home page shows depends on the date and on day / night (GMT+8).
CREATE TABLE IF NOT EXISTS hero_banners (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(80)  NOT NULL DEFAULT '',
  img        VARCHAR(600) NOT NULL,
  slot       ENUM('all','day','night') NOT NULL DEFAULT 'all',
  start_date DATE NULL DEFAULT NULL,
  end_date   DATE NULL DEFAULT NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extra pictures of a listing (the first one is the cover; properties.img always mirrors it).
CREATE TABLE IF NOT EXISTS property_photos (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  property_id INT UNSIGNED NOT NULL,
  img         VARCHAR(600) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  KEY idx_property_photos (property_id, sort_order),
  CONSTRAINT fk_property_photos_property FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
