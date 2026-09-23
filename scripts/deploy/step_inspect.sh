echo "=== look at installer script ==="
sudo docker run --rm --entrypoint /bin/sh appwrite/appwrite:1.9.6 -c "ls -la /usr/src/appwrite/ 2>/dev/null; echo '---'; find /usr/src/appwrite -maxdepth 2 -name '*.php' -o -name '*.sh' -o -name 'docker-compose*' 2>/dev/null | head; echo '--- entrypoint ---'; cat /usr/local/bin/docker-php-entrypoint 2>/dev/null | head -30"
