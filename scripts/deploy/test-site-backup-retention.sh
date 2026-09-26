#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
TEST_ROOT=$(mktemp -d "$REPO_ROOT/.site-backup-test.XXXXXX")
trap 'rm -rf -- "$TEST_ROOT"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_mocks() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/sudo" <<'MOCK'
#!/usr/bin/env bash
set -e
exec "$@"
MOCK
  cat > "$bin_dir/date" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' 20260926010101
MOCK
  cat > "$bin_dir/unzip" <<'MOCK'
#!/usr/bin/env bash
set -e
destination=
while (($#)); do
  if [[ $1 == -d ]]; then
    destination=$2
    shift 2
  else
    shift
  fi
done
[[ -n $destination ]]
mkdir -p "$destination/assets"
printf 'new bundle\n' > "$destination/assets/index-new.js"
printf '<html><script src="/assets/index-new.js"></script><script src="/umami/script.js"></script></html>\n' > "$destination/index.html"
printf 'unpacked\n'
MOCK
  cat > "$bin_dir/chown" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  cat > "$bin_dir/nginx" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  cat > "$bin_dir/systemctl" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  cat > "$bin_dir/curl" <<'MOCK'
#!/usr/bin/env bash
set -e
url=${!#}
[[ ${MOCK_FAIL_HTTP:-0} != 1 ]] || exit 22
if [[ $url == http://127.0.0.1/ ]]; then
  printf '<html><script src="/assets/%s"></script></html>\n' "${MOCK_SERVED_INDEX:-index-new.js}"
fi
MOCK
  chmod +x "$bin_dir"/*
}

prepare_fixture() {
  local fixture=$1
  mkdir -p "$fixture/site/assets" "$fixture/parent"
  printf 'old bundle\n' > "$fixture/site/assets/index-old.js"
  printf '<html><script src="/assets/index-old.js"></script></html>\n' > "$fixture/site/index.html"
  mkdir -p "$fixture/parent/qingyu-web.bak.202601010000"
  mkdir -p "$fixture/parent/qingyu-web.bak.20260201000000"
  mkdir -p "$fixture/parent/qingyu-web.bak.20260301000000"
  printf 'old backup\n' > "$fixture/parent/qingyu-web.bak.202601010000/marker"
  mkdir -p "$fixture/parent/keep-this-directory"
  printf 'keep\n' > "$fixture/parent/keep-this-directory/marker"
  ln -s "$fixture/parent/keep-this-directory" "$fixture/parent/qingyu-web.bak.20251201000000"
  make_mocks "$fixture/bin"
}

run_case() {
  local script_name=$1
  local mode=$2
  local fixture="$TEST_ROOT/${script_name%.sh}.$mode"
  prepare_fixture "$fixture"

  local served_index=index-new.js
  [[ $mode != failed-verification ]] || served_index=index-old.js

  set +e
  PATH="$fixture/bin:$PATH" \
    SITE_ROOT="$fixture/site" \
    BACKUP_PARENT="$fixture/parent" \
    DIST_ZIP="$fixture/fake-dist.zip" \
    MOCK_SERVED_INDEX="$served_index" \
    bash "$SCRIPT_DIR/$script_name" > "$fixture/output.log" 2>&1
  local result=$?
  set -e

  if [[ $mode == success ]]; then
    [[ $result == 0 ]] || { cat "$fixture/output.log" >&2; fail "$script_name should succeed"; }
    mapfile -t retained < <(find "$fixture/parent" -mindepth 1 -maxdepth 1 -type d -name 'qingyu-web.bak.*' -printf '%f\n' | sort)
    [[ ${#retained[@]} == 2 ]] || fail "$script_name retained ${#retained[@]} timestamped backup directories, expected 2"
    [[ ${retained[0]} == qingyu-web.bak.20260301000000 ]] || fail "$script_name did not retain the newest prior backup"
    [[ ${retained[1]} == qingyu-web.bak.20260926010101 ]] || fail "$script_name did not retain the new backup"
  else
    [[ $result != 0 ]] || fail "$script_name should fail when the served bundle does not match"
    for prior in 202601010000 20260201000000 20260301000000; do
      [[ -d "$fixture/parent/qingyu-web.bak.$prior" ]] || fail "$script_name removed a prior backup after failed verification"
    done
  fi

  [[ -d "$fixture/parent/keep-this-directory" ]] || fail "$script_name changed an unrelated directory"
  [[ -L "$fixture/parent/qingyu-web.bak.20251201000000" ]] || fail "$script_name changed a backup-named symlink"
}

run_collision_case() {
  local script_name=$1
  local fixture="$TEST_ROOT/${script_name%.sh}.collision"
  prepare_fixture "$fixture"
  mkdir -p "$fixture/parent/qingyu-web.bak.20260926010101"
  printf 'do not overwrite\n' > "$fixture/parent/qingyu-web.bak.20260926010101/marker"

  set +e
  PATH="$fixture/bin:$PATH" \
    SITE_ROOT="$fixture/site" \
    BACKUP_PARENT="$fixture/parent" \
    DIST_ZIP="$fixture/fake-dist.zip" \
    bash "$SCRIPT_DIR/$script_name" > "$fixture/output.log" 2>&1
  local result=$?
  set -e

  [[ $result != 0 ]] || fail "$script_name should refuse a colliding backup timestamp"
  [[ $(cat "$fixture/parent/qingyu-web.bak.20260926010101/marker") == 'do not overwrite' ]] || fail "$script_name overwrote a colliding backup"
  [[ -f "$fixture/site/assets/index-old.js" ]] || fail "$script_name changed the active site after a backup collision"
  for prior in 202601010000 20260201000000 20260301000000; do
    [[ -d "$fixture/parent/qingyu-web.bak.$prior" ]] || fail "$script_name pruned backups after a timestamp collision"
  done
}

for script in deploy_remote.sh step_deploy2.sh _run_remote.sh; do
  run_case "$script" success
  run_case "$script" failed-verification
  run_collision_case "$script"
done

echo 'PASS: all deployment scripts retain two verified backups and preserve backups on failure'
