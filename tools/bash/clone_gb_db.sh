#!/usr/bin/env bash
set -euo pipefail

# -------- Your app user (unchanged) --------
HOST="127.0.0.1"
SRC_DB="test1000rovers"
TGT_DB="rules1000rovers"
APP_USER="rover"
APP_PASS='7Pegq7RawamFr8Uu!'   # single quotes keep ! safe

# -------- Admin user for CREATE/GRANT --------
# Provide via env or be prompted (recommended: root)
ADMIN_USER="${ADMIN_USER:-root}"
ADMIN_PASS="${ADMIN_PASS:-}"

if [[ -z "${ADMIN_PASS}" ]]; then
  read -s -p "Enter MySQL admin password for ${ADMIN_USER}@${HOST}: " ADMIN_PASS
  echo
fi

DATESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="./${SRC_DB}-${DATESTAMP}.sql.gz"

echo "== Phase 0: Clone MySQL database =="
echo "Host:     ${HOST}"
echo "Source:   ${SRC_DB}"
echo "Target:   ${TGT_DB}"
echo "App user: ${APP_USER}"
echo "Admin:    ${ADMIN_USER}"
echo "Dump:     ${DUMP_FILE}"
echo

# 1) Dump source with APP user
echo "--> Dumping source DB '${SRC_DB}' ..."
mysqldump -h "${HOST}" -u "${APP_USER}" -p"${APP_PASS}" \
  --single-transaction --routines --triggers --events \
  --default-character-set=utf8mb4 "${SRC_DB}" | gzip -c > "${DUMP_FILE}"

# 2) Create target DB with ADMIN user
echo "--> Creating target DB '${TGT_DB}' (admin) ..."
mysql -h "${HOST}" -u "${ADMIN_USER}" -p"${ADMIN_PASS}" \
  -e "CREATE DATABASE IF NOT EXISTS \`${TGT_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3) Ensure APP user can access target DB (admin)
echo "--> Granting privileges to '${APP_USER}' on '${TGT_DB}' (admin) ..."
mysql -h "${HOST}" -u "${ADMIN_USER}" -p"${ADMIN_PASS}" <<SQL
CREATE USER IF NOT EXISTS '${APP_USER}'@'localhost' IDENTIFIED BY '${APP_PASS}';
CREATE USER IF NOT EXISTS '${APP_USER}'@'127.0.0.1' IDENTIFIED BY '${APP_PASS}';
GRANT ALL PRIVILEGES ON \`${TGT_DB}\`.* TO '${APP_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${TGT_DB}\`.* TO '${APP_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# 4) Import dump into target with APP user
echo "--> Importing dump into '${TGT_DB}' ..."
gunzip -c "${DUMP_FILE}" | mysql -h "${HOST}" -u "${APP_USER}" -p"${APP_PASS}" "${TGT_DB}"

# 5) Clean scoring tables in target with APP user
echo "--> Deleting rows from 'answer' and 'preclassification' in '${TGT_DB}' ..."
mysql -h "${HOST}" -u "${APP_USER}" -p"${APP_PASS}" "${TGT_DB}" <<SQL
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM answer;
DELETE FROM preclassification;
SET FOREIGN_KEY_CHECKS=1;
SQL

# 6) Show quick row counts to confirm empties
echo "--> Sanity check (row counts):"
mysql -N -h "${HOST}" -u "${APP_USER}" -p"${APP_PASS}" "${TGT_DB}" -e "SELECT 'answer', COUNT(*) FROM answer UNION ALL SELECT 'preclassification', COUNT(*) FROM preclassification;"

echo "== Done =="
echo "Target DB '${TGT_DB}' is ready for Phase 1 (replay)."