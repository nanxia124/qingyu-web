API=http://127.0.0.1/v1
PROJECT=qingyu
TEST_EMAIL="testuser@qingyu.local"
TEST_PASS="Test123456!"

echo "=== 1. create account in qingyu project ==="
curl -s -X POST "$API/account" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: $PROJECT" \
  -d "{\"userId\":\"unique()\",\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\",\"name\":\"Test User\"}" 2>&1 | head -c 500
echo ""
echo "=== 2. create session (login) ==="
curl -s -X POST "$API/account/sessions/email" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: $PROJECT" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" 2>&1 | head -c 500
echo ""
echo "=== 3. get account with session cookie ==="
curl -s -X POST "$API/account/sessions/email" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: $PROJECT" \
  -c /tmp/qingyu_cookies.txt \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" > /dev/null 2>&1
curl -s -H "X-Appwrite-Project: $PROJECT" -b /tmp/qingyu_cookies.txt "$API/account" 2>&1 | head -c 400
echo ""
