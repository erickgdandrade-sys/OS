#!/usr/bin/env bash
# Aplica as migrations num Postgres local descartável e roda os testes de RLS.
# Uso: PGHOST=/caminho/socket PGPORT=5432 scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/../supabase"
DB=${TEST_DB:-nexo_test}
P="psql -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d "$DB" -f tests/local_supabase_stub.sql
for f in migrations/*.sql; do $P -d "$DB" -f "$f"; done
$P -d "$DB" -c "grant select, insert, update, delete on all tables in schema public to anon, authenticated; grant select, insert, delete on storage.objects to authenticated;"
$P -d "$DB" -f tests/rls_test.sql
