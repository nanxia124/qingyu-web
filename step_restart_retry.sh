echo "=== restart appwrite to recognize root user ==="
sudo docker restart appwrite
echo "waiting 25s..."
sleep 25
API=http://127.0.0.1/v1
JAR=/tmp/appwrite_cookies.txt
EMAIL="admin@qingyu.local"
PASS="Qingyu93a97225d8faf9e52026!"

echo "=== re-login ==="
curl -s -X POST "$API/account/sessions/email" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: console" \
  -c "$JAR" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" 2>&1 | head -c 200
echo ""
echo "=== who am i / role ==="
curl -s -H "X-Appwrite-Project: console" -b "$JAR" "$API/account" 2>&1 | head -c 300
echo ""
echo "=== try create project ==="
curl -s -X POST "$API/projects" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: console" \
  -b "$JAR" \
  -d '{"projectId":"qingyu","name":"轻域AI Qingyu","region":"default"}' 2>&1 | head -c 500
echo ""
