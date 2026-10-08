-- Runs once, on the first start of an empty Postgres volume (see compose.yaml).
-- One database per service (see the service map in ROADMAP.md).
-- Redis-only services (cart) don't need one.
CREATE DATABASE auth;
CREATE DATABASE catalog;
CREATE DATABASE inventory;
CREATE DATABASE orders;
CREATE DATABASE payments;
CREATE DATABASE notifications;
