cd ~/appwrite
wget -q https://raw.githubusercontent.com/appwrite/appwrite/1.9.6/.env -O .env.template
echo "=== .env line count ==="
wc -l .env.template
echo "=== required/key vars ==="
grep -nE '^_APP_(ENV|EDITION|VERSION|IMAGE|DOMAIN|HTTP_PORT|HTTPS_PORT|OPENSSL_KEY_V1|DB_|REDIS_|CONSOLE|OPTIONS|USAGE_STATS|STORAGE|FUNCTIONS|EXECUTOR|COMPUTE)' .env.template | head -60
