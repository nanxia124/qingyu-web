cd ~/appwrite
echo "=== current swap ==="
swapon --show
free -h
echo "=== add 4GB swapfile if not present ==="
if [ ! -f /swapfile2 ]; then
  sudo fallocate -l 4G /swapfile2 || sudo dd if=/dev/zero of=/swapfile2 bs=1M count=4096
  sudo chmod 600 /swapfile2
  sudo mkswap /swapfile2
  sudo swapon /swapfile2
  echo "added swapfile2"
else
  echo "swapfile2 exists"
fi
free -h
echo "=== pull all images (this takes a while) ==="
sudo docker compose pull 2>&1 | tail -20
echo "=== PULL DONE exit=$? ==="
