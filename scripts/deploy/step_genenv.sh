cd ~/appwrite
set -e
# generate secrets
OPENSSL_KEY=$(openssl rand -hex 32)
DB_PASS=$(openssl rand -hex 16)
DB_ROOT_PASS=$(openssl rand -hex 16)
EXEC_SECRET=$(openssl rand -hex 32)

cp .env.template .env

# apply overrides
sed -i "s|^_APP_ENV=.*|_APP_ENV=production|" .env
sed -i "s|^_APP_OPENSSL_KEY_V1=.*|_APP_OPENSSL_KEY_V1=${OPENSSL_KEY}|" .env
sed -i "s|^_APP_DOMAIN=.*|_APP_DOMAIN=litzone.art|" .env
sed -i "s|^_APP_DOMAIN_FUNCTIONS=.*|_APP_DOMAIN_FUNCTIONS=litzone.art|" .env
sed -i "s|^_APP_DOMAIN_SITES=.*|_APP_DOMAIN_SITES=litzone.art|" .env
sed -i "s|^_APP_DOMAIN_TARGET_A=.*|_APP_DOMAIN_TARGET_A=litzone.art|" .env
sed -i "s|^_APP_CONSOLE_DOMAIN=.*|_APP_CONSOLE_DOMAIN=console.litzone.art|" .env
sed -i "s|^_APP_DB_PASS=.*|_APP_DB_PASS=${DB_PASS}|" .env
sed -i "s|^_APP_DB_ROOT_PASS=.*|_APP_DB_ROOT_PASS=${DB_ROOT_PASS}|" .env
sed -i "s|^_APP_EXECUTOR_SECRET=.*|_APP_EXECUTOR_SECRET=${EXEC_SECRET}|" .env
sed -i "s|^_APP_USAGE_STATS=.*|_APP_USAGE_STATS=disabled|" .env
sed -i "s|^_APP_FUNCTIONS_RUNTIMES=.*|_APP_FUNCTIONS_RUNTIMES=node-22|" .env

# append port overrides (not in template)
cat >> .env <<'EOF'
_APP_VERSION=1.9.6
_APP_HTTP_PORT=8080
_APP_HTTPS_PORT=8443
EOF

echo "=== verify key settings ==="
grep -E '^_APP_(ENV|VERSION|DOMAIN=|HTTP_PORT|HTTPS_PORT|DB_PASS|DB_ROOT_PASS|OPENSSL_KEY_V1|EXECUTOR_SECRET|CONSOLE_DOMAIN|USAGE_STATS)' .env | sed 's|_APP_OPENSSL_KEY_V1=.*|_APP_OPENSSL_KEY_V1=***(set)***|; s|_APP_DB_PASS=.*|_APP_DB_PASS=***(set)***|; s|_APP_DB_ROOT_PASS=.*|_APP_DB_ROOT_PASS=***(set)***|; s|_APP_EXECUTOR_SECRET=.*|_APP_EXECUTOR_SECRET=***(set)***|'
echo "=== files ready ==="
ls -la
