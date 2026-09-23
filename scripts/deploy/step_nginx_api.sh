set -e
sudo tee /etc/nginx/sites-available/qingyu-web > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root /var/www/qingyu-web;
    index index.html;
    server_name _;

    # AI API 后端（密钥管理、模型配置、请求代理）
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }

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

sudo nginx -t
sudo systemctl reload nginx
echo "=== test /api/config/public via nginx ==="
curl -s http://127.0.0.1/api/config/public
echo ""
echo "=== test /api/admin/login via nginx ==="
curl -s -X POST http://127.0.0.1/api/admin/login -H "Content-Type: application/json" -d '{"username":"admin","password":"QingyuAdmin2026!"}' | head -c 100
echo ""
echo "=== test /v1 still works ==="
curl -s http://127.0.0.1/v1/health/version
echo ""
