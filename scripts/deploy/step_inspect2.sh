echo "=== image config ==="
sudo docker inspect appwrite/appwrite:1.9.6 --format '{{json .Config}}' | python3 -m json.tool 2>/dev/null | head -40
echo "=== find installer php ==="
sudo docker run --rm --entrypoint /bin/sh appwrite/appwrite:1.9.6 -c "find / -maxdepth 4 -name 'install*.php' 2>/dev/null; echo '---'; ls -la /var/www 2>/dev/null; ls -la /usr/src 2>/dev/null"
