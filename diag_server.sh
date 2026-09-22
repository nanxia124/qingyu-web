echo "=== docker containers ==="
sudo docker ps -a 2>/dev/null || echo "no docker"
echo "=== all listening ports (incl sudo) ==="
sudo ss -tlnp 2>/dev/null
echo "=== node/dotnet/python backend processes ==="
ps aux | grep -E 'node|dotnet|python|qingyu|server' | grep -v grep
echo "=== existing nginx confs ==="
sudo ls -la /etc/nginx/sites-enabled/ 2>/dev/null
sudo ls -la /etc/nginx/conf.d/ 2>/dev/null
echo "=== docker nginx conf mount? ==="
sudo find / -name '*.conf' -path '*nginx*' 2>/dev/null | grep -v '/etc/nginx/sites' | head
echo "=== home dir server files ==="
ls -la ~/
ls -la /opt/ 2>/dev/null
