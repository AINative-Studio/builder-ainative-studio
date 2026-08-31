# ainative-registry auth (#386)

Self-hosted Docker Distribution registry (`ainative-registry` Railway
service, private-network-only, no public domain) with real htpasswd basic
auth. See `Dockerfile` for the rebuild/rotation procedure.

Verified live (this session): unauthenticated requests to `/v2/` return 401
with a `WWW-Authenticate: Basic` challenge; requests with valid credentials
return 200; requests with invalid credentials return 401. Push (blob
upload start + complete) also verified working with valid credentials.
