# ainative-registry (#386) — self-hosted Docker Distribution registry with
# htpasswd basic auth baked in. Deployed to the existing `ainative-registry`
# Railway service via `railway up --path-as-root` (same mechanism proven for
# per-company deploys in lib/build/company-deploy.ts).
#
# Rebuild/rotate credentials:
#   1. htpasswd -Bbn <username> <password> > infra/registry/auth.htpasswd
#      (bcrypt hash — auth.htpasswd itself is gitignored, never commit real
#      credentials; generate it fresh into this directory before deploying)
#   2. railway up infra/registry --path-as-root --service ainative-registry
#      --project 47539617-ae34-4a52-a010-a88d875f347e --environment production
#   3. Store the plaintext username/password as REGISTRY_AUTH_USERNAME /
#      REGISTRY_AUTH_PASSWORD Railway service variables for reference (the
#      running registry itself only reads the baked-in htpasswd file, so
#      these variables are documentation/rotation reference, not consumed by
#      the container directly).
#
# Storage (S3 -> MinIO) config is already set as Railway service variables on
# ainative-registry (REGISTRY_STORAGE_S3_*) — unaffected by this image change.
FROM registry:2.8.3
COPY auth.htpasswd /etc/docker/registry/auth.htpasswd
ENV REGISTRY_AUTH=htpasswd
ENV REGISTRY_AUTH_HTPASSWD_REALM="AINative Registry"
ENV REGISTRY_AUTH_HTPASSWD_PATH=/etc/docker/registry/auth.htpasswd
