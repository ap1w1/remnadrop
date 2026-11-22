# Upstream Go binary is copied UNMODIFIED from the author's pinned immutable image.
# sha c5ce367c5f38a345fad59bb813fd9fd67c80a329 = release 5.1.0.
FROM ghcr.io/syvlech/remnawave-limiter:c5ce367 AS upstream
FROM python:3.12-alpine
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 limiter \
    && mkdir -p /app/geoip && chown -R limiter:limiter /app
COPY --from=upstream /usr/local/bin/remnawave-limiter /usr/local/bin/remnawave-limiter
COPY integrations/limiter-5.1/supervisor.py /usr/local/bin/limiter-supervisor.py
WORKDIR /app
USER limiter
ENTRYPOINT ["python3", "/usr/local/bin/limiter-supervisor.py"]
