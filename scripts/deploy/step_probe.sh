cd ~/appwrite
echo "=== expect available? ==="
which expect || echo no-expect
which python3
echo "=== run installer with pty, capture first screen ==="
rm -f docker-compose.yml .env 2>/dev/null
script -qec "sudo docker run --rm -i --volume /var/run/docker.sock:/var/run/docker.sock --volume /home/ubuntu/appwrite:/usr/src/appwrite appwrite/appwrite:1.9.6" /tmp/install.log < /dev/null &
BGPID=$!
sleep 8
kill $BGPID 2>/dev/null
echo "=== installer screen ==="
cat /tmp/install.log | tr -d '\r' | head -60
