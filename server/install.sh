#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

DOMAIN="vendussnovaera.venduss.com"
APP_NAME="venduss-nova-era"
APP_USER="vendussnovaera"
APP_ROOT="/opt/venduss-nova-era"
APP_HOME="/var/lib/venduss-nova-era"
APP_PORT="3113"
APP_SERVICE="venduss-nova-era.service"
APP_CONTAINER="venduss-nova-era-app"
REPOSITORY="https://github.com/uniquessatacado/vendussnovaera.git"
BRANCH="main"
TMP_DIR="$(mktemp -d)"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
PREVIOUS_RELEASE=""
SWITCHED_RELEASE="0"
NPM_CONTAINER=""
NPM_CONTAINER_NAME=""
NPM_DATA_HOST=""
NPM_NETWORK=""
NPM_NETWORK_MODE=""
NPM_GATEWAY=""
APP_BIND="127.0.0.1"

log() {
  printf '\n\033[1;34m[NOVA ERA]\033[0m %s\n' "$*"
}

fail() {
  printf '\n\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TMP_DIR:-}" && "${TMP_DIR}" == /tmp/* && -d "${TMP_DIR}" ]]; then
    rm -rf -- "${TMP_DIR}"
  fi
}

rollback() {
  local line="$1"
  trap - ERR
  set +e
  printf '\n\033[1;31m[ERRO]\033[0m A instalação parou na linha %s.\n' "${line}" >&2
  if [[ "${SWITCHED_RELEASE}" == "1" && -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${APP_ROOT}/current.rollback"
    mv -Tf "${APP_ROOT}/current.rollback" "${APP_ROOT}/current"
    if docker inspect "${APP_CONTAINER}" >/dev/null 2>&1 && declare -F start_docker_release >/dev/null; then
      start_docker_release "${PREVIOUS_RELEASE}" || true
    else
      systemctl restart "${APP_SERVICE}" >/dev/null 2>&1 || true
    fi
    printf 'A versão anterior foi restaurada.\n' >&2
  fi
  printf 'Envie uma foto deste erro para o Codex.\n' >&2
  exit 1
}

trap 'rollback $LINENO' ERR
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || fail "Entre como root antes de executar o instalador."

log "Preparando o servidor sem alterar os outros sistemas"
apt-get update -y
apt-get install -y ca-certificates curl git xz-utils openssl python3-venv

TOTAL_MEMORY_MB="$(free -m | awk '/^Mem:/ {print $2}')"
TOTAL_SWAP_MB="$(free -m | awk '/^Swap:/ {print $2}')"
if [[ "${TOTAL_MEMORY_MB}" -lt 1800 && "${TOTAL_SWAP_MB}" -lt 1024 ]]; then
  log "Criando memória auxiliar para a instalação"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile 2>/dev/null || true
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

install_node() {
  if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    return
  fi

  log "Instalando Node.js 22"
  local machine node_arch sums package
  machine="$(uname -m)"
  case "${machine}" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) fail "Arquitetura não suportada automaticamente: ${machine}" ;;
  esac

  sums="${TMP_DIR}/SHASUMS256.txt"
  curl -fsSL --retry 3 -o "${sums}" "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt"
  package="$(awk -v suffix="linux-${node_arch}.tar.xz" '$2 ~ suffix "$" {print $2; exit}' "${sums}")"
  [[ -n "${package}" ]] || fail "Não foi possível localizar o pacote do Node.js."
  curl -fsSL --retry 3 -o "${TMP_DIR}/${package}" "https://nodejs.org/dist/latest-v22.x/${package}"
  (
    cd "${TMP_DIR}"
    grep "  ${package}$" SHASUMS256.txt | sha256sum -c -
  )
  tar -xJf "${TMP_DIR}/${package}" -C /usr/local --strip-components=1
  hash -r
}

install_node
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
NPM_CLI="$(readlink -f "${NPM_BIN}")"
"${NODE_BIN}" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || \
  fail "É necessário Node.js 22 ou superior."

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${APP_HOME}" --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_HOME}" "${APP_ROOT}/releases"

if [[ -L "${APP_ROOT}/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current" || true)"
fi

SUPABASE_URL="https://kedggjyerexnzmipaick.supabase.co"
SUPABASE_KEY="sb_publishable_WoobBV7n0p5Jf-4DLJVzIA_4sUoAvsT"

[[ "${SUPABASE_URL}" == https://*.supabase.co ]] || fail "A URL do Supabase é inválida."
[[ "${SUPABASE_KEY}" == sb_publishable_* ]] || fail "A Publishable Key do Supabase é inválida."

umask 077
cat > "${APP_ROOT}/shared.env" <<EOF
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${SUPABASE_KEY}
EOF
chown "${APP_USER}:${APP_USER}" "${APP_ROOT}/shared.env"
chmod 600 "${APP_ROOT}/shared.env"
umask 022

log "Baixando o código da Nova Era Venduss"
git clone --depth 1 --branch "${BRANCH}" "${REPOSITORY}" "${RELEASE_DIR}"
rm -rf -- "${RELEASE_DIR}/.git"
install -m 0600 -o "${APP_USER}" -g "${APP_USER}" "${APP_ROOT}/shared.env" "${RELEASE_DIR}/.env.local"
chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"

log "Instalando e compilando o sistema"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="/usr/local/bin:/usr/bin:/bin" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' ci --include=dev --no-audit --no-fund"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="/usr/local/bin:/usr/bin:/bin" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' run build"

[[ -f "${RELEASE_DIR}/dist/server/index.js" ]] || fail "A compilação do sistema não foi criada."
[[ -f "${RELEASE_DIR}/node_modules/vinext/dist/cli.js" ]] || fail "O inicializador do sistema não foi instalado."

find_npm_container() {
  command -v docker >/dev/null 2>&1 || return 1
  local container_id image_name
  while read -r container_id image_name; do
    if [[ "${image_name,,}" == *"nginx-proxy-manager"* || "${image_name,,}" == *"nginxproxymanager"* ]]; then
      printf '%s\n' "${container_id}"
      return
    fi
  done < <(docker ps --format '{{.ID}} {{.Image}}')
  while read -r container_id; do
    if docker exec "${container_id}" sh -c 'test -d /data/nginx/proxy_host && command -v nginx >/dev/null 2>&1' >/dev/null 2>&1; then
      printf '%s\n' "${container_id}"
      return
    fi
  done < <(docker ps -q)
  return 1
}

NPM_CONTAINER="$(find_npm_container || true)"
if [[ -n "${NPM_CONTAINER}" ]]; then
  log "Nginx Proxy Manager detectado"
  NPM_CONTAINER_NAME="$(docker inspect --format '{{.Name}}' "${NPM_CONTAINER}" | sed 's#^/##')"
  NPM_DATA_HOST="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "${NPM_CONTAINER}")"
  NPM_NETWORK_MODE="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "${NPM_CONTAINER}")"
  [[ -n "${NPM_CONTAINER_NAME}" && -n "${NPM_DATA_HOST}" && -d "${NPM_DATA_HOST}" ]] || \
    fail "Não foi possível localizar os dados do Nginx Proxy Manager."
  if [[ "${NPM_NETWORK_MODE}" != "host" ]]; then
    NPM_NETWORK="$(docker inspect --format '{{range $name, $settings := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${NPM_CONTAINER}" | awk '$1 != "bridge" && $1 != "host" && $1 != "none" {print; exit}')"
    NPM_GATEWAY="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' "${NPM_CONTAINER}" | awk '{print $1}')"
    [[ -n "${NPM_NETWORK}" && -n "${NPM_GATEWAY}" ]] || fail "Não foi possível localizar a rede do Nginx Proxy Manager."
    APP_BIND="${NPM_GATEWAY}"
  fi
fi

ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current.next"
mv -Tf "${APP_ROOT}/current.next" "${APP_ROOT}/current"
SWITCHED_RELEASE="1"

cat > "/etc/systemd/system/${APP_SERVICE}" <<EOF
[Unit]
Description=Nova Era Venduss
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_ROOT}/current
Environment=NODE_ENV=production
Environment=HOME=${APP_HOME}
EnvironmentFile=${APP_ROOT}/shared.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=${NODE_BIN} ${APP_ROOT}/current/node_modules/vinext/dist/cli.js start --port ${APP_PORT} --hostname ${APP_BIND}
Restart=always
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${APP_ROOT} ${APP_HOME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
if [[ -n "${NPM_CONTAINER}" && "${NPM_NETWORK_MODE}" != "host" ]]; then
  systemctl disable --now "${APP_SERVICE}" >/dev/null 2>&1 || true
else
  systemctl enable --now "${APP_SERVICE}"
  systemctl restart "${APP_SERVICE}"
fi

wait_for_local() {
  local ready="0"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 "http://${APP_BIND}:${APP_PORT}/" >/dev/null 2>&1; then
      ready="1"
      break
    fi
    sleep 1
  done
  [[ "${ready}" == "1" ]]
}

start_docker_release() {
  local source_dir="$1"
  docker pull node:22-bookworm-slim >/dev/null
  docker rm -f "${APP_CONTAINER}" >/dev/null 2>&1 || true
  docker run -d \
    --name "${APP_CONTAINER}" \
    --restart unless-stopped \
    --network "${NPM_NETWORK}" \
    --mount "type=bind,src=${source_dir},dst=/app,readonly" \
    --workdir /app \
    --env NODE_ENV=production \
    --env-file "${APP_ROOT}/shared.env" \
    node:22-bookworm-slim \
    node node_modules/vinext/dist/cli.js start --port "${APP_PORT}" --hostname 0.0.0.0 >/dev/null
}

npm_http_get() {
  local url="$1"
  local host_header="${2:-}"
  local insecure="${3:-0}"
  docker exec "${NPM_CONTAINER_NAME}" sh -c '
    url="$1"; host_header="$2"; insecure="$3"
    if command -v curl >/dev/null 2>&1; then
      tls=""; [ "${insecure}" = "1" ] && tls="-k"
      if [ -n "${host_header}" ]; then exec curl ${tls} -fsS --max-time 15 -H "Host: ${host_header}" "${url}"; fi
      exec curl ${tls} -fsS --max-time 15 "${url}"
    fi
    if command -v wget >/dev/null 2>&1; then
      tls=""; [ "${insecure}" = "1" ] && tls="--no-check-certificate"
      if [ -n "${host_header}" ]; then exec wget -qO- ${tls} --timeout=15 --header="Host: ${host_header}" "${url}"; fi
      exec wget -qO- ${tls} --timeout=15 "${url}"
    fi
    exit 127
  ' sh "${url}" "${host_header}" "${insecure}"
}

wait_for_npm_response() {
  local url="$1"
  local host_header="$2"
  local expected="$3"
  local response=""

  for _ in $(seq 1 45); do
    response="$(npm_http_get "${url}" "${host_header}" 2>/dev/null || true)"
    if [[ "${response}" == "${expected}" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_npm_success() {
  local url="$1"
  local host_header="$2"
  local insecure="${3:-0}"

  for _ in $(seq 1 45); do
    if npm_http_get "${url}" "${host_header}" "${insecure}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if [[ -n "${NPM_CONTAINER}" && "${NPM_NETWORK_MODE}" != "host" ]]; then
  log "Conectando somente a Nova Era Venduss à rede do proxy"
  start_docker_release "${RELEASE_DIR}"
  for _ in $(seq 1 60); do
    npm_http_get "http://${APP_CONTAINER}:${APP_PORT}/" >/dev/null 2>&1 && break
    sleep 1
  done
  npm_http_get "http://${APP_CONTAINER}:${APP_PORT}/" >/dev/null || {
    docker logs --tail 100 "${APP_CONTAINER}" || true
    fail "O container da Nova Era Venduss não iniciou corretamente."
  }
  systemctl disable --now "${APP_SERVICE}" >/dev/null 2>&1 || true
else
  wait_for_local || {
    journalctl -u "${APP_SERVICE}" -n 100 --no-pager || true
    fail "A Nova Era Venduss não iniciou corretamente."
  }
fi

prepare_certbot() {
  local system_certbot certbot_venv
  system_certbot="$(command -v certbot 2>/dev/null || true)"
  if [[ -n "${system_certbot}" ]] && "${system_certbot}" --version >/dev/null 2>&1; then
    CERTBOT_BIN="${system_certbot}"
    return
  fi
  log "Preparando o certificado HTTPS"
  certbot_venv="/opt/vendussnovaera-certbot"
  python3 -m venv "${certbot_venv}"
  "${certbot_venv}/bin/python" -m pip install --disable-pip-version-check --no-cache-dir --upgrade pip setuptools wheel certbot
  CERTBOT_BIN="${certbot_venv}/bin/certbot"
}

CERTBOT_BIN=""
prepare_certbot

issue_certificate() {
  local attempt
  local wait_seconds

  for attempt in 1 2 3; do
    log "Solicitando o certificado HTTPS (tentativa ${attempt}/3)"
    if "${CERTBOT_BIN}" certonly --webroot --webroot-path "${NPM_ACME_HOST}" --domain "${DOMAIN}" \
      --non-interactive --agree-tos --register-unsafely-without-email --preferred-challenges http; then
      return 0
    fi

    if [[ "${attempt}" -lt 3 ]]; then
      wait_seconds="$((attempt * 15))"
      log "O Let’s Encrypt não respondeu. Tentando novamente em ${wait_seconds} segundos"
      sleep "${wait_seconds}"
    fi
  done
  return 1
}

if [[ -n "${NPM_CONTAINER}" ]]; then
  log "Configurando o domínio ${DOMAIN}"
  docker exec "${NPM_CONTAINER_NAME}" nginx -T 2>&1 | grep -F '/data/nginx/proxy_host/*.conf' >/dev/null || \
    fail "A pasta de hosts do Nginx Proxy Manager não está ativa."
  NPM_PROXY_DIR_HOST="${NPM_DATA_HOST}/nginx/proxy_host"
  NPM_VHOST_HOST="${NPM_PROXY_DIR_HOST}/99998-venduss-nova-era.conf"
  NPM_ACME_HOST="${NPM_DATA_HOST}/vendussnovaera-acme"
  NPM_SSL_HOST="${NPM_DATA_HOST}/vendussnovaera-ssl"
  install -d "${NPM_PROXY_DIR_HOST}" "${NPM_ACME_HOST}/.well-known/acme-challenge" "${NPM_SSL_HOST}"
  NPM_UPSTREAM_HOST="${APP_BIND}"
  [[ "${NPM_NETWORK_MODE}" == "host" ]] || NPM_UPSTREAM_HOST="${APP_CONTAINER}"

  cat > "${NPM_VHOST_HOST}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location ^~ /.well-known/acme-challenge/ {
        root /data/vendussnovaera-acme;
        default_type text/plain;
        try_files \$uri =404;
    }
    location / {
        proxy_pass http://${NPM_UPSTREAM_HOST}:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
  docker exec "${NPM_CONTAINER_NAME}" nginx -t
  docker exec "${NPM_CONTAINER_NAME}" nginx -s reload
  docker exec "${NPM_CONTAINER_NAME}" nginx -T 2>&1 | grep -F "server_name ${DOMAIN};" >/dev/null || \
    fail "O Nginx Proxy Manager não carregou a configuração da Nova Era Venduss."

  PREFLIGHT_TOKEN="vendussnovaera-${RELEASE_ID}"
  printf '%s\n' "${PREFLIGHT_TOKEN}" > "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"
  PREFLIGHT_URL="http://127.0.0.1/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"
  if ! wait_for_npm_response "${PREFLIGHT_URL}" "${DOMAIN}" "${PREFLIGHT_TOKEN}"; then
    rm -f -- "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"
    fail "O Nginx Proxy Manager não publicou a rota do domínio após 45 segundos."
  fi
  rm -f -- "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"

  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    issue_certificate || fail "O Let’s Encrypt não respondeu após três tentativas."
  fi
  [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]] || fail "O certificado HTTPS não foi criado."
  install -m 0644 "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${NPM_SSL_HOST}/fullchain.pem"
  install -m 0600 "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${NPM_SSL_HOST}/privkey.pem"

  cat > "${NPM_VHOST_HOST}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location ^~ /.well-known/acme-challenge/ {
        root /data/vendussnovaera-acme;
        default_type text/plain;
        try_files \$uri =404;
    }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};
    ssl_certificate /data/vendussnovaera-ssl/fullchain.pem;
    ssl_certificate_key /data/vendussnovaera-ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:NEVSSL:10m;
    ssl_session_timeout 1d;
    client_max_body_size 20m;
    location / {
        proxy_pass http://${NPM_UPSTREAM_HOST}:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
EOF
  docker exec "${NPM_CONTAINER_NAME}" nginx -t
  docker exec "${NPM_CONTAINER_NAME}" nginx -s reload

  install -d /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/reload-vendussnovaera-nginx.sh <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
install -m 0644 "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${NPM_SSL_HOST}/fullchain.pem"
install -m 0600 "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${NPM_SSL_HOST}/privkey.pem"
docker exec "${NPM_CONTAINER_NAME}" nginx -t
docker exec "${NPM_CONTAINER_NAME}" nginx -s reload
EOF
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-vendussnovaera-nginx.sh
else
  fail "O Nginx Proxy Manager não foi encontrado. O instalador parou sem alterar os outros proxies."
fi

cat > /etc/systemd/system/vendussnovaera-certbot-renew.service <<EOF
[Unit]
Description=Renovar HTTPS da Nova Era Venduss
After=network-online.target
[Service]
Type=oneshot
ExecStart=${CERTBOT_BIN} renew --quiet
EOF

cat > /etc/systemd/system/vendussnovaera-certbot-renew.timer <<'EOF'
[Unit]
Description=Renovação automática do HTTPS da Nova Era Venduss
[Timer]
OnCalendar=*-*-* 04:10:00
RandomizedDelaySec=12h
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now vendussnovaera-certbot-renew.timer

if [[ -n "${NPM_CONTAINER}" && "${NPM_NETWORK_MODE}" != "host" ]]; then
  [[ "$(docker inspect --format '{{.State.Running}}' "${APP_CONTAINER}" 2>/dev/null)" == "true" ]]
else
  systemctl is-active --quiet "${APP_SERVICE}"
fi
wait_for_npm_success "https://127.0.0.1/" "${DOMAIN}" 1 || \
  fail "O HTTPS da Nova Era Venduss não respondeu após 45 segundos."

SWITCHED_RELEASE="0"
printf '\n\033[1;32mNova Era Venduss instalada com sucesso.\033[0m\n'
printf 'Site: https://%s\n' "${DOMAIN}"
printf 'Supabase Auth: adicione https://%s/** nos endereços de redirecionamento permitidos.\n' "${DOMAIN}"
printf 'Os demais sistemas e containers não foram alterados.\n'
