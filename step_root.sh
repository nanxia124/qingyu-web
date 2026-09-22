echo "=== appwrite logs (root/admin/setup related) ==="
sudo docker logs appwrite 2>&1 | grep -iE "root|admin|setup|install|console|scope|permission" | tail -20
echo "=== try GET projects list ==="
curl -s -H "X-Appwrite-Project: console" -b /tmp/appwrite_cookies.txt "http://127.0.0.1/v1/projects" 2>&1 | head -c 400
echo ""
echo "=== try /v1/project (singular) ==="
curl -s -X POST "http://127.0.0.1/v1/project" -H "Content-Type: application/json" -H "X-Appwrite-Project: console" -b /tmp/appwrite_cookies.txt -d '{"projectId":"qingyu","name":"qingyu"}' 2>&1 | head -c 300
echo ""
echo "=== check if there's a setup endpoint ==="
curl -s "http://127.0.0.1/v1/health" 2>&1 | head -c 300
echo ""
