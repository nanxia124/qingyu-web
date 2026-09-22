cd ~/appwrite
echo "=== download mongo helpers ==="
wget -q https://raw.githubusercontent.com/appwrite/appwrite/1.9.6/mongo-init.js -O mongo-init.js && echo "got mongo-init.js" || echo "FAIL mongo-init"
wget -q https://raw.githubusercontent.com/appwrite/appwrite/1.9.6/mongo-entrypoint.sh -O mongo-entrypoint.sh && echo "got mongo-entrypoint.sh" || echo "FAIL mongo-entrypoint"
ls -la mongo* 2>/dev/null
echo "=== try official .env ==="
for url in \
  "https://raw.githubusercontent.com/appwrite/appwrite/1.9.6/.env" \
  "https://raw.githubusercontent.com/appwrite/appwrite/1.9.6/.env.example" \
  "https://appwrite.io/docker-compose.yml"; do
  echo "--- trying $url"
  wget -q "$url" -O /tmp/test_out && head -3 /tmp/test_out && echo "OK" || echo "FAIL"
done
