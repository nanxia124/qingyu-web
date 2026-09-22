cd ~/appwrite
echo "=== backup current compose ==="
cp docker-compose.yml docker-compose.yml.1.9.6.bak
echo "=== download 2.2.0 compose ==="
wget -q https://raw.githubusercontent.com/appwrite/appwrite/2.2.0/docker-compose.yml -O docker-compose.yml && echo "OK $(wc -l < docker-compose.yml) lines" || echo "FAILED"
echo "=== key differences: image tags ==="
grep -nE 'image: (appwrite|traefik|mongo|redis|mariadb|openruntimes)' docker-compose.yml | head -20
echo "=== worker entrypoints ==="
grep -nE 'entrypoint:' docker-compose.yml | head -20
