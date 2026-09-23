set -e
# Update console domain to match nginx (port 80, no :8080)
cd ~/appwrite
sed -i "s|^_APP_CONSOLE_DOMAIN=.*|_APP_CONSOLE_DOMAIN=litzone.art|" .env
echo "console domain now:"
grep _APP_CONSOLE_DOMAIN .env

# Write new nginx config
sudo tee /etc/nginx/sites-available/qingyu-web > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root /var/www/qingyu-web;
    index index.html;
    server_name _;

    # Appwrite API + Realtime
    location /v1/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Appwrite Console
    location /console/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Static frontend (SPA)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

echo "=== nginx config test ==="
sudo nginx -t
echo "=== reload nginx ==="
sudo systemctl reload nginx
echo "=== verify API through nginx (port 80) ==="
curl -s http://127.0.0.1/v1/health/version
echo ""
echo "=== verify external via public IP ==="
curl -s http://43.160.249.6/v1/health/version
echo ""
