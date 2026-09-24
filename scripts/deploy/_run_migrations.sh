set -e
export PGPASSWORD=qingyu_local_dev
cd /tmp/migrations
for f in $(ls *.sql | sort); do
  echo "APPLY $f"
  psql -U user -d qingyu_business -v ON_ERROR_STOP=1 -f "/tmp/migrations/$f" > /tmp/out.log 2>&1
  if [ $? -ne 0 ]; then
    echo "FAILED at $f"
    tail -40 /tmp/out.log
    exit 1
  fi
done
echo "ALL_DONE"
