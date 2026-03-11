-- ============================================================
--  MakeAcademy Push Notifications
--  Run this once on your makeacademy.in database
-- ============================================================

CREATE TABLE IF NOT EXISTS `ma_push_subscriptions` (
  `id`         INT(11)       NOT NULL AUTO_INCREMENT,
  `user_email` VARCHAR(255)  NOT NULL,
  `endpoint`   TEXT          NOT NULL,
  `p256dh`     VARCHAR(512)  DEFAULT NULL,
  `auth_key`   VARCHAR(255)  DEFAULT NULL,
  `created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_endpoint` ( (LEFT(`endpoint`, 500)) ),
  KEY `idx_user_email` (`user_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
--  Optional: link to your users table via email (foreign key)
--  Enable only if Email column in users is unique/indexed.
-- ============================================================
-- ALTER TABLE `ma_push_subscriptions`
--   ADD CONSTRAINT `fk_ma_push_user`
--   FOREIGN KEY (`user_email`) REFERENCES `users` (`Email`)
--   ON DELETE CASCADE ON UPDATE CASCADE;
