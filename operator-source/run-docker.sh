#!/usr/bin/env bash
# Git Bash / Docker Desktop operator entrypoint. No production secret in argv or files.
set -euo pipefail
package_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
state_file="$package_dir/.operator-state"
head='d01d2992659dbab3d6aff95581dd6bed5f618daf'
tree='4c5583b65e2963ff71f6cd4f8212b10832e50e65'
node_image='node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c'
pg_image='postgres@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652'
tools_image='campuspay-release-d01-tools:local'
mode=${1:-}
stop() { printf 'STOP: %s\n' "$1" >&2; exit 1; }
winpath() {
  if [[ $(uname -s) == MINGW* || $(uname -s) == MSYS* ]]; then (cd -- "$1" && pwd -W)
  else (cd -- "$1" && pwd -P); fi
}
check_source() {
  [[ $# -eq 1 ]] || stop 'SOURCE_DIRECTORY_REQUIRED'
  source_dir=$(cd -- "$1" && pwd -P)
  [[ $(git -C "$source_dir" rev-parse HEAD) == "$head" ]] || stop 'SOURCE_HEAD_MISMATCH'
  [[ $(git -C "$source_dir" rev-parse 'HEAD^{tree}') == "$tree" ]] || stop 'SOURCE_TREE_MISMATCH'
  [[ -z $(git -C "$source_dir" status --porcelain) ]] || stop 'SOURCE_NOT_CLEAN'
  source_mount=$(winpath "$source_dir")
  package_mount=$(winpath "$package_dir")
}
check_images() {
  docker image inspect "$node_image" "$pg_image" >/dev/null 2>&1 ||
    stop "PINNED_IMAGES_MISSING: run docker pull $node_image and docker pull $pg_image, then retry"
}
load_state() {
  [[ -f $state_file ]] || stop 'SETUP_REQUIRED'
  # State contains only names derived from timestamp/PID, never a credential.
  source "$state_file"
  [[ $run_id =~ ^[0-9]+_[0-9]+$ ]] || stop 'STATE_INVALID'
  [[ $(docker inspect -f '{{.State.Running}}' "$pg_container" 2>/dev/null) == true ]] || stop 'DISPOSABLE_POSTGRES_NOT_RUNNING'
}
set_mounts() {
  mounts=(--mount "type=volume,src=$source_volume,dst=/source,readonly"
    --mount "type=bind,src=$package_mount,dst=/package,readonly"
    --mount "type=volume,src=$evidence_volume,dst=/evidence")
}
if [[ $mode == setup ]]; then
  [[ $# -eq 2 ]] || stop 'USAGE_SETUP_SOURCE_DIRECTORY'
  [[ ! -e $state_file ]] || stop 'SETUP_ALREADY_EXISTS'
  check_source "$2"
  check_images
  MSYS_NO_PATHCONV=1 docker build --pull=false --network=none -t "$tools_image" "$package_mount"
  run_id="$(date +%s)_$$"
  pg_container="cp_d01_pg_$run_id"
  evidence_volume="cp_d01_evidence_$run_id"
  source_volume="cp_d01_source_$run_id"
  docker volume create "$evidence_volume" >/dev/null
  docker volume create "$source_volume" >/dev/null
  local_password="cp_local_${run_id}"
  docker run -d --rm --name "$pg_container" --log-driver none --tmpfs /var/lib/postgresql/data:rw,size=1024m \
    -e "POSTGRES_PASSWORD=$local_password" "$pg_image" >/dev/null
  printf 'run_id=%s\npg_container=%s\nevidence_volume=%s\nsource_volume=%s\n' \
    "$run_id" "$pg_container" "$evidence_volume" "$source_volume" > "$state_file"
  chmod 600 "$state_file"
  for attempt in {1..30}; do
    if docker exec "$pg_container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
    if [[ $attempt -eq 30 ]]; then stop 'DISPOSABLE_POSTGRES_START_FAILED'; fi
    sleep 1
  done
  set_mounts
  MSYS_NO_PATHCONV=1 docker run --rm --log-driver none --network none \
    --mount "type=bind,src=$source_mount,dst=/input,readonly" \
    --mount "type=volume,src=$source_volume,dst=/source" "$tools_image" \
    sh -c 'tar -C /input --exclude=.git -cf - . | tar -C /source -xf -'
  MSYS_NO_PATHCONV=1 docker run --rm --log-driver none --network "container:$pg_container" \
    --mount "type=volume,src=$source_volume,dst=/source" --workdir /source \
    "$tools_image" npm ci --omit=dev --no-audit --no-fund
  MSYS_NO_PATHCONV=1 docker run --rm --log-driver none --network none \
    "${mounts[@]}" "$tools_image" node /package/verify-source.mjs /source --files-only
  printf 'DOCKER_SETUP_READY: %s\n' "$run_id"
  exit 0
fi
if [[ $mode == export-backup ]]; then
  [[ $# -eq 2 ]] || stop 'USAGE_EXPORT_BACKUP_OUTPUT_DIRECTORY'
  load_state
  output_dir=$(cd -- "$2" && pwd -P)
  output_mount=$(winpath "$output_dir")
  MSYS_NO_PATHCONV=1 docker run --rm --log-driver none --network none \
    --mount "type=volume,src=$evidence_volume,dst=/evidence" \
    --mount "type=bind,src=$output_mount,dst=/out" "$tools_image" \
    node -e 'const fs=require("fs"),c=require("crypto"),p="/evidence/campuspay-before-39-40.cpbackup",q="/evidence/backup-restore-verified.json";if(!fs.existsSync(q)||!fs.existsSync(p)){console.error("STOP: BACKUP_RESTORE_PROOF_MISSING");process.exit(1)}const proof=JSON.parse(fs.readFileSync(q));const h=x=>c.createHash("sha256").update(fs.readFileSync(x)).digest("hex");if(proof.status!=="BACKUP_AND_LOCAL_RESTORE_VERIFIED"||proof.sha256!==h(p)||fs.existsSync("/out/campuspay-before-39-40.cpbackup")){console.error("STOP: BACKUP_EXPORT_NOT_SAFE");process.exit(1)}fs.copyFileSync(p,"/out/campuspay-before-39-40.cpbackup",fs.constants.COPYFILE_EXCL);if(h("/out/campuspay-before-39-40.cpbackup")!==proof.sha256)process.exit(1);fs.writeFileSync("/evidence/backup-exported.json",JSON.stringify({sha256:proof.sha256,verifiedAt:new Date().toISOString()})+"\n",{flag:"wx",mode:0o600});console.log("BACKUP_EXPORTED_VERIFIED "+proof.sha256)'
  exit 0
fi
if [[ $mode == stop-local ]]; then
  [[ $# -eq 1 ]] || stop 'USAGE_STOP_LOCAL'
  load_state
  docker stop "$pg_container" >/dev/null
  printf 'LOCAL_POSTGRES_STOPPED; evidence volume retained: %s\n' "$evidence_volume"
  exit 0
fi
[[ $mode == preflight || $mode == backup-and-restore || $mode == apply || $mode == postflight ]] ||
  stop 'USAGE: setup SOURCE | preflight SOURCE | backup-and-restore SOURCE | export-backup OUTPUT_DIR | apply SOURCE | postflight SOURCE | stop-local'
[[ $# -eq 2 ]] || stop 'SOURCE_DIRECTORY_REQUIRED'
check_source "$2"
load_state
set_mounts
if [[ $mode == apply ]]; then
  MSYS_NO_PATHCONV=1 docker run --rm --log-driver none --network none \
    --mount "type=volume,src=$evidence_volume,dst=/evidence,readonly" "$tools_image" \
    node -e 'const fs=require("fs"),c=require("crypto"),p=JSON.parse(fs.readFileSync("/evidence/backup-restore-verified.json")),e=JSON.parse(fs.readFileSync("/evidence/backup-exported.json")),b=fs.readFileSync("/evidence/campuspay-before-39-40.cpbackup");if(p.sha256!==e.sha256||p.sha256!==c.createHash("sha256").update(b).digest("hex")||fs.existsSync("/evidence/migration-attempt-started.json"))process.exit(1)'
  printf 'This applies ONLY schema 39 and 40 under maintenance. Type APPLY-39-40 to continue: '
  read -r phrase
  [[ $phrase == APPLY-39-40 ]] || stop 'APPLY_CANCELLED'
fi
local_password="cp_local_${run_id}"
docker_tty=(docker)
if [[ $(uname -s) == MINGW* || $(uname -s) == MSYS* ]]; then
  command -v winpty >/dev/null 2>&1 || stop 'WINPTY_REQUIRED_FOR_HIDDEN_TERMINAL_PROMPT'
  docker_tty=(winpty docker)
fi
MSYS_NO_PATHCONV=1 "${docker_tty[@]}" run --rm -it --log-driver none --network "container:$pg_container" \
  "${mounts[@]}" --workdir /source \
  -e "CAMPUSPAY_OPERATOR_HOST_GIT_VERIFIED=$head" \
  -e "CAMPUSPAY_LOCAL_RESTORE_URL=postgresql://postgres:${local_password}@127.0.0.1:5432/postgres" \
  "$tools_image" node /package/run-release.mjs "$mode" /source /evidence
