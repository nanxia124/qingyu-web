sudo docker pull appwrite/appwrite:1.9.6 2>&1 | tail -2
echo "=== installer help ==="
sudo docker run --rm appwrite/appwrite:1.9.6 help 2>&1 | head -50
