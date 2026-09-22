cd ~/appwrite
echo "=== try release tag compose ==="
wget -q https://raw.githubusercontent.com/appwrite/appwrite/1.7.13/docker-compose.yml -O docker-compose.prod.yml && echo OK || echo FAILED
echo "=== image tags in prod compose ==="
grep -nE 'image: appwrite' docker-compose.prod.yml | head
echo "=== ports in prod compose ==="
grep -nE '^\s*-\s*"?[0-9]+:|ports:|published' docker-compose.prod.yml | head -20
echo "=== env example available? ==="
wget -q https://raw.githubusercontent.com/appwrite/appwrite/1.7.13/.env -O env.example && echo "got .env" || echo "no .env at root"
ls -la
