#!/bin/sh
set -eu
binary=${0##*/}
case "$binary" in pg_dump|pg_restore) ;; *) exit 1 ;; esac
if [ "${PGSSLMODE:-}" = verify-full ]; then
  # libpq does not use the system roots without this explicit setting.
  # pgTool strips inherited PG* settings; this is scoped to its verified-TLS call.
  [ -s /etc/ssl/certs/ca-certificates.crt ] || exit 1
  export PGSSLROOTCERT=system
  SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
  export SSL_CERT_FILE
  unset SSL_CERT_DIR
  unset OPENSSL_CONF
fi
LD_LIBRARY_PATH=/opt/pgroot/lib/x86_64-linux-gnu:/opt/pgroot/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH
exec "/opt/pg-bin/$binary" "$@"
