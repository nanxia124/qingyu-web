echo "=== available appwrite tags ==="
curl -s "https://hub.docker.com/v2/repositories/appwrite/appwrite/tags?page_size=20" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(t['name']) for t in d.get('results',[])]" 2>/dev/null || curl -s "https://hub.docker.com/v2/repositories/appwrite/appwrite/tags?page_size=20" | head -c 2000
