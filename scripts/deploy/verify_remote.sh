echo "=== local curl headers ==="
curl -sI http://localhost/ | head -8
echo "=== index js ref ==="
curl -s http://localhost/ | grep -o 'assets/index-[^"]*\.js'
echo "=== asset status ==="
curl -sI http://localhost/assets/index-BS3Trt2D.js | head -3
echo "=== SPA deep route test ==="
curl -sI http://localhost/some/deep/route | head -3
echo "=== verify done ==="
