echo "=== pull installer image ==="
sudo docker pull appwrite/appwrite:1.7.x 2>&1 | tail -3
echo "=== installer help ==="
sudo docker run --rm appwrite/appwrite:1.7.x help 2>&1 | head -40
