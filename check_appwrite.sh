echo "=== look for appwrite install ==="
ls -la /opt/appwrite 2>/dev/null && echo FOUND_OPT_APPWRITE
ls -la /root/appwrite 2>/dev/null && echo FOUND_ROOT_APPWRITE
sudo find / -maxdepth 4 -name 'docker-compose.yml' 2>/dev/null | grep -i appwrite
sudo find / -maxdepth 4 -type d -iname '*appwrite*' 2>/dev/null
echo "=== docker images (appwrite?) ==="
sudo docker images 2>/dev/null
echo "=== any non-80 web port listening ==="
sudo ss -tlnp 2>/dev/null
echo "=== nginx all server blocks ==="
sudo nginx -T 2>/dev/null | grep -E 'server_name|listen|proxy_pass|root |location' | head -40
