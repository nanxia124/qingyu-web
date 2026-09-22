cd ~/appwrite
echo "=== run installer without TTY ==="
sudo docker run --rm \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume /home/ubuntu/appwrite:/usr/src/appwrite \
  appwrite/appwrite:1.9.6 2>&1 | head -40
echo "=== files produced ==="
ls -la ~/appwrite
