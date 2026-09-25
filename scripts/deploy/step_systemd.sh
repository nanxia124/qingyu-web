set -e
echo "=== create systemd service ==="
sudo tee /etc/systemd/system/qingyu-api.service > /dev/null <<'SERVICE'
[Unit]
Description=Qingyu AI API Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/qingyu-api
ExecStart=/usr/bin/node /home/ubuntu/qingyu-api/api-server.mjs
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/etc/qingyu-api.env

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable qingyu-api
# 先杀掉 nohup 进程，用 systemd 启动
pkill -f "node.*api-server.mjs" 2>/dev/null || true
sleep 1
sudo systemctl start qingyu-api
sleep 2
echo "=== service status ==="
sudo systemctl is-active qingyu-api
sudo systemctl is-enabled qingyu-api
echo "=== test ==="
curl -s http://127.0.0.1:3001/api/config/public
echo ""
