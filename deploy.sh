#!/bin/bash
# ── Neutara Ticketing — Server Deploy Script ──────────────────────────────────
set -e

echo "==> Setting DB password..."
docker exec -i jira_postgres psql -U jirauser -c "ALTER USER jirauser WITH PASSWORD 'Neutara@2024';" -d postgres

echo "==> Copying .env.server to .env..."
cp .env.server .env

echo "==> Restoring database..."
docker cp neutara_db_backup.sql jira_postgres:/tmp/neutara_db_backup.sql
docker exec -i jira_postgres psql -U jirauser -c "DROP DATABASE IF EXISTS jiradb; CREATE DATABASE jiradb;" -d postgres
docker exec -i jira_postgres psql -U jirauser -d jiradb -f /tmp/neutara_db_backup.sql

echo "==> Installing dependencies..."
npm install

echo "==> Building app..."
npm run build

echo "==> Starting app..."
npm start
