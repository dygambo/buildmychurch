-- One-time local setup. Run as a Postgres superuser:  psql -U postgres -f scripts/setup-db.sql
-- Two roles: the owner runs migrations; the app role is what the website uses and is subject to row-level security.
CREATE ROLE bmc_owner LOGIN PASSWORD 'bmc_owner';
CREATE ROLE bmc_app LOGIN PASSWORD 'bmc_app';
CREATE DATABASE buildmychurch OWNER bmc_owner;
CREATE DATABASE buildmychurch_test OWNER bmc_owner;
\c buildmychurch
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT USAGE ON SCHEMA public TO bmc_app;
\c buildmychurch_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT USAGE ON SCHEMA public TO bmc_app;
