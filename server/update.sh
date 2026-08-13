#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="vendussnovaera"
APP_ROOT="/opt/venduss-nova-era"
APP_HOME="/var/lib/venduss-nova-era"
APP_PORT="3113"
APP_SERVICE="venduss-nova-era.service"
APP_CONTAINER="venduss-nova-era-app"
REPOSITORY="https://github.com/uniquessatacado/vendussnovaera.git"
BRANCH="main"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
PREVIOUS_RELEASE=""
SWITCHED_RELEASE="0"
DOCKER_MODE="0"
DOCKER_NETWORK=""
DOCKER_IMAGE="node:22-bookworm-slim"

log() { printf '\n\033[1;34m[NOVA ERA]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }

start_docker_release() {
  local source_dir="$1"
  docker rm -f "${APP_CONTAINER}" >/dev/null 2>&1 || true
  docker run -d --name "${APP_CONTAINER}" --restart unless-stopped \
    --network "${DOCKER_NETWORK}" \
    --mount "type=bind,src=${source_dir},dst=/app,readonly" \
    --workdir /app --env NODE_ENV=production --env-file "${APP_ROOT}/shared.env" \
    "${DOCKER_IMAGE}" node node_modules/vinext/dist/cli.js start --port "${APP_PORT}" --hostname 0.0.0.0 >/dev/null
}

wait_for_docker() {
  for _ in $(seq 1 60); do
    docker exec "${APP_CONTAINER}" node -e \
      "fetch('http://127.0.0.1:${APP_PORT}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

rollback() {
  local line="$1"
  trap - ERR
  set +e
  printf '\n\033[1;31m[ERRO]\033[0m A atualização parou na linha %s.\n' "${line}" >&2
  if [[ "${SWITCHED_RELEASE}" == "1" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${APP_ROOT}/current.rollback"
    mv -Tf "${APP_ROOT}/current.rollback" "${APP_ROOT}/current"
    if [[ "${DOCKER_MODE}" == "1" ]]; then
      start_docker_release "${PREVIOUS_RELEASE}"
    else
      systemctl restart "${APP_SERVICE}"
    fi
    printf 'A versão anterior foi restaurada automaticamente.\n' >&2
  fi
  exit 1
}
trap 'rollback $LINENO' ERR

[[ "${EUID}" -eq 0 ]] || fail "Execute como root."
[[ -L "${APP_ROOT}/current" && -f "${APP_ROOT}/shared.env" ]] || fail "A instalação da Nova Era Venduss não foi encontrada."

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
NPM_CLI="$(readlink -f "${NPM_BIN}")"
[[ -n "${NODE_BIN}" && -f "${NPM_CLI}" ]] || fail "Node.js/npm não foram encontrados."
PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current")"

if command -v docker >/dev/null 2>&1 && docker inspect "${APP_CONTAINER}" >/dev/null 2>&1; then
  DOCKER_MODE="1"
  DOCKER_NETWORK="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "${APP_CONTAINER}")"
  DOCKER_IMAGE="$(docker inspect --format '{{.Config.Image}}' "${APP_CONTAINER}")"
fi

log "Baixando a nova versão"
git clone --depth 1 --branch "${BRANCH}" "${REPOSITORY}" "${RELEASE_DIR}"
rm -rf -- "${RELEASE_DIR}/.git"
install -m 0600 -o "${APP_USER}" -g "${APP_USER}" "${APP_ROOT}/shared.env" "${RELEASE_DIR}/.env.local"
chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"

runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="/usr/local/bin:/usr/bin:/bin" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' ci --include=dev --no-audit --no-fund"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="/usr/local/bin:/usr/bin:/bin" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' run build"

[[ -f "${RELEASE_DIR}/dist/server/index.js" ]] || fail "A nova versão não compilou."
ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current.next"
mv -Tf "${APP_ROOT}/current.next" "${APP_ROOT}/current"
SWITCHED_RELEASE="1"

if [[ "${DOCKER_MODE}" == "1" ]]; then
  start_docker_release "${RELEASE_DIR}"
  wait_for_docker || {
    docker logs --tail 100 "${APP_CONTAINER}" || true
    fail "A nova versão não iniciou."
  }
else
  systemctl restart "${APP_SERVICE}"
  for _ in $(seq 1 60); do
    curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/" >/dev/null
fi

SWITCHED_RELEASE="0"
printf '\n\033[1;32mNova Era Venduss atualizada com sucesso.\033[0m\n'
printf 'Site: https://vendussnovaera.venduss.com\n'
