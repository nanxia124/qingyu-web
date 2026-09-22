set -e
mkdir -p ~/appwrite
cd ~/appwrite
echo "=== download docker-compose.yml ==="
wget -q https://raw.githubusercontent.com/appwrite/appwrite/1.7.x/docker-compose.yml -O docker-compose.yml && echo OK || echo "FAILED 1.7.x"
echo "=== file size ==="
wc -l docker-compose.yml
echo "=== ports exposed ==="
grep -nE 'ports:|published|APPWRITE_PORT|443|80:|8080' docker-compose.yml | head -30
echo "=== image tag ==="
grep -nE 'image: appwrite' docker-compose.yml | head
