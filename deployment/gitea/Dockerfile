# Gitea Docker image for Railway deployment
# Uses the official Gitea rootless image for security

FROM gitea/gitea:1.22-rootless

# Environment defaults (override via Railway variables)
ENV USER_UID=1000
ENV USER_GID=1000
ENV GITEA__database__DB_TYPE=postgres
ENV GITEA__server__HTTP_PORT=3000
ENV GITEA__server__ROOT_URL=https://git.ainative.studio
ENV GITEA__server__DISABLE_SSH=true
ENV GITEA__service__DISABLE_REGISTRATION=true
ENV GITEA__service__REQUIRE_SIGNIN_VIEW=true
ENV GITEA__security__INSTALL_LOCK=true
ENV GITEA__repository__DEFAULT_PRIVATE=private
ENV GITEA__api__ENABLE_SWAGGER=false

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/healthz || exit 1

EXPOSE 3000
