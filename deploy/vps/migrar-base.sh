#!/usr/bin/env bash
# Copia la base de Neon a la Postgres local del VPS. Se corre en el VPS, como
# root, con la app frenada (si no, entran escrituras a mitad de la copia):
#
#   bash migrar-base.sh 'postgresql://...neon.tech/neondb?sslmode=require'
#
# La base local se pisa entera. Neon queda intacta (solo se lee).
set -euo pipefail

ORIGEN="${1:?Uso: migrar-base.sh <DATABASE_URL de Neon>}"
DB_NAME=nexttap
DB_USER=nexttap
DUMP=/var/backups/nexttap/neon-$(date +%F-%H%M).dump

systemctl stop nexttap 2>/dev/null || true

echo "== Bajando la base de Neon → $DUMP"
pg_dump --format=custom --no-owner --no-privileges "$ORIGEN" > "$DUMP"
ls -lh "$DUMP"

echo "== Restaurando en la base local ($DB_NAME)"
sudo -u postgres dropdb --if-exists "$DB_NAME"
sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
sudo -u postgres pg_restore --no-owner --role="$DB_USER" --dbname="$DB_NAME" "$DUMP"
# Lo restaurado como postgres pasa a ser del usuario de la app.
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'ALTER TABLE ' || r.t || ' OWNER TO ${DB_USER}'; END LOOP;
  FOR r IN SELECT format('%I.%I', sequence_schema, sequence_name) AS t FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE 'ALTER SEQUENCE ' || r.t || ' OWNER TO ${DB_USER}'; END LOOP;
  FOR r IN SELECT format('%I.%I', table_schema, table_name) AS t FROM information_schema.views WHERE table_schema = 'public' LOOP
    EXECUTE 'ALTER VIEW ' || r.t || ' OWNER TO ${DB_USER}'; END LOOP;
END \$\$;
SQL

echo "== Control: filas por tabla, Neon vs local"
EXACTO="SELECT string_agg(format('SELECT %L AS tabla, count(*) FROM %I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"
Q_NEON=$(psql "$ORIGEN" -Atc "$EXACTO")
Q_LOCAL=$(sudo -u postgres psql -d "$DB_NAME" -Atc "$EXACTO")
diff <(psql "$ORIGEN" -Atc "$Q_NEON" | sort) <(sudo -u postgres psql -d "$DB_NAME" -Atc "$Q_LOCAL" | sort) \
  && echo "OK: todas las tablas tienen la misma cantidad de filas." \
  || { echo "OJO: hay diferencias (arriba). No sigas sin revisarlas."; exit 1; }

systemctl start nexttap
echo "Listo. La app corre contra la base local."
