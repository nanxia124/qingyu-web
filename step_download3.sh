cd ~/appwrite
rm -f docker-compose.yml
echo "=== try tag 1.9.6 ==="
wget -q https://raw.githubusercontent.com/appwrite/appwrite/1.9.6/docker-compose.yml -O docker-compose.yml && echo OK || echo FAILED
wc -l docker-compose.yml
echo "=== image tags used ==="
grep -nE 'image: appwrite' docker-compose.yml | head
echo "=== first 5 lines ==="
head -5 docker-compose.yml
