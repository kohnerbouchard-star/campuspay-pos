# Offline-built tools image: pinned Node 22 and PostgreSQL 17.11 client binaries.
# Contains no CampusPay source, credentials, backup or database state.
FROM postgres@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652 AS pgclient
RUN set -eu; mkdir -p /client-libs; \
    for binary in /usr/lib/postgresql/17/bin/pg_dump /usr/lib/postgresql/17/bin/pg_restore; do \
      ldd "$binary" | awk '$2 == "=>" { print $3 }'; \
    done | sort -u | while read -r library; do \
      mkdir -p "/client-libs/$(dirname "$library")"; \
      cp -L "$library" "/client-libs/$library"; \
    done

FROM node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
COPY --from=pgclient /client-libs/ /opt/pgroot/
COPY --from=pgclient /usr/lib/postgresql/17/bin/pg_dump /opt/pg-bin/pg_dump
COPY --from=pgclient /usr/lib/postgresql/17/bin/pg_restore /opt/pg-bin/pg_restore
RUN printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/pgroot/lib/x86_64-linux-gnu:/opt/pgroot/usr/lib/x86_64-linux-gnu exec /opt/pg-bin/pg_dump "$@"\n' > /usr/local/bin/pg_dump && \
    printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/pgroot/lib/x86_64-linux-gnu:/opt/pgroot/usr/lib/x86_64-linux-gnu exec /opt/pg-bin/pg_restore "$@"\n' > /usr/local/bin/pg_restore && \
    chmod 755 /usr/local/bin/pg_dump /usr/local/bin/pg_restore && \
    pg_dump --version && pg_restore --version
