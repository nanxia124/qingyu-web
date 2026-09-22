echo "=== what is sites-enabled/qingyu-web ==="
ls -la /etc/nginx/sites-enabled/
echo "=== content of sites-enabled/qingyu-web ==="
cat /etc/nginx/sites-enabled/qingyu-web
echo ""
echo "=== is there a default site? ==="
ls -la /etc/nginx/sites-enabled/default 2>/dev/null && echo "default exists" || echo "no default"
echo "=== nginx.conf include line ==="
grep -n "include.*sites" /etc/nginx/nginx.conf
