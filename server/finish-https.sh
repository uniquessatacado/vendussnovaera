#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="vendussnovaera.venduss.com"
APP_PORT="3113"
APP_CONTAINER="venduss-nova-era-app"
NPM_CONTAINER=""
NPM_CONTAINER_NAME=""
NPM_DATA_HOST=""
NPM_NETWORK_MODE=""
NPM_UPSTREAM_HOST=""

log() {
  printf '\n\033[1;34m[NOVA ERA]\033[0m %s\n' "$*"
}

fail() {
  printf '\n\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2
  exit 1
}

trap 'fail "A conclusão do HTTPS parou na linha $LINENO."' ERR

[[ "${EUID}" -eq 0 ]] || fail "Execute este comando como root."

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

npm_http_get() {
  local url="$1"
  local host_header="${2:-}"
  local insecure="${3:-0}"
  local resolve_domain="${4:-}"
  docker exec "${NPM_CONTAINER_NAME}" sh -c '
    url="$1"; host_header="$2"; insecure="$3"; resolve_domain="$4"
    if command -v curl >/dev/null 2>&1; then
      tls=""; [ "${insecure}" = "1" ] && tls="-k"
      if [ -n "${resolve_domain}" ]; then
        exec curl ${tls} -fsS --max-time 15 \
          --resolve "${resolve_domain}:443:127.0.0.1" \
          -H "Host: ${host_header}" "${url}"
      fi
      if [ -n "${host_header}" ]; then exec curl ${tls} -fsS --max-time 15 -H "Host: ${host_header}" "${url}"; fi
      exec curl ${tls} -fsS --max-time 15 "${url}"
    fi
    if command -v wget >/dev/null 2>&1; then
      tls=""; [ "${insecure}" = "1" ] && tls="--no-check-certificate"
      if [ -n "${host_header}" ]; then exec wget -qO- ${tls} --timeout=15 --header="Host: ${host_header}" "${url}"; fi
      exec wget -qO- ${tls} --timeout=15 "${url}"
    fi
    exit 127
  ' sh "${url}" "${host_header}" "${insecure}" "${resolve_domain}"
}

wait_for_content() {
  local url="$1"
  local host_header="$2"
  local expected="$3"
  local response=""
  for _ in $(seq 1 45); do
    response="$(npm_http_get "${url}" "${host_header}" 2>/dev/null || true)"
    [[ "${response}" == "${expected}" ]] && return 0
    sleep 1
  done
  return 1
}

issue_certificate() {
  local attempt wait_seconds
  for attempt in 1 2 3; do
    log "Solicitando o certificado HTTPS (tentativa ${attempt}/3)"
    curl -4fsS --connect-timeout 10 --max-time 30 \
      https://acme-v02.api.letsencrypt.org/directory >/dev/null 2>&1 || \
      log "A conexão com o Let’s Encrypt ainda está lenta; o Certbot tentará mesmo assim"

    if "${CERTBOT_BIN}" certonly \
      --webroot \
      --webroot-path "${NPM_ACME_HOST}" \
      --domain "${DOMAIN}" \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      --preferred-challenges http; then
      return 0
    fi

    if [[ "${attempt}" -lt 3 ]]; then
      wait_seconds="$((attempt * 15))"
      log "Aguardando ${wait_seconds} segundos antes da próxima tentativa"
      sleep "${wait_seconds}"
    fi
  done
  return 1
}

log "Retomando somente a configuração do HTTPS"
NPM_CONTAINER="$(find_npm_container || true)"
[[ -n "${NPM_CONTAINER}" ]] || fail "O Nginx Proxy Manager não foi encontrado."
NPM_CONTAINER_NAME="$(docker inspect --format '{{.Name}}' "${NPM_CONTAINER}" | sed 's#^/##')"
NPM_DATA_HOST="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "${NPM_CONTAINER}")"
NPM_NETWORK_MODE="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "${NPM_CONTAINER}")"
[[ -n "${NPM_CONTAINER_NAME}" && -n "${NPM_DATA_HOST}" && -d "${NPM_DATA_HOST}" ]] || \
  fail "Não foi possível localizar os dados do Nginx Proxy Manager."

if [[ "${NPM_NETWORK_MODE}" == "host" ]]; then
  NPM_UPSTREAM_HOST="127.0.0.1"
else
  [[ "$(docker inspect --format '{{.State.Running}}' "${APP_CONTAINER}" 2>/dev/null || true)" == "true" ]] || \
    fail "O aplicativo Nova Era não está em execução. Rode novamente o instalador completo."
  NPM_UPSTREAM_HOST="${APP_CONTAINER}"
fi

npm_http_get "http://${NPM_UPSTREAM_HOST}:${APP_PORT}/" >/dev/null || \
  fail "O aplicativo Nova Era não respondeu dentro da rede do proxy."

NPM_PROXY_DIR_HOST="${NPM_DATA_HOST}/nginx/proxy_host"
NPM_VHOST_HOST="${NPM_PROXY_DIR_HOST}/99998-venduss-nova-era.conf"
NPM_ACME_HOST="${NPM_DATA_HOST}/vendussnovaera-acme"
NPM_SSL_HOST="${NPM_DATA_HOST}/vendussnovaera-ssl"
install -d "${NPM_PROXY_DIR_HOST}" "${NPM_ACME_HOST}/.well-known/acme-challenge" "${NPM_SSL_HOST}"

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

PREFLIGHT_TOKEN="vendussnovaera-resume-$(date -u +%s)"
printf '%s\n' "${PREFLIGHT_TOKEN}" > "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"
if ! wait_for_content "http://127.0.0.1/.well-known/acme-challenge/${PREFLIGHT_TOKEN}" "${DOMAIN}" "${PREFLIGHT_TOKEN}"; then
  rm -f -- "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"
  fail "A rota do domínio não respondeu no Nginx Proxy Manager."
fi
rm -f -- "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"

if [[ -x /opt/vendussnovaera-certbot/bin/certbot ]]; then
  CERTBOT_BIN="/opt/vendussnovaera-certbot/bin/certbot"
else
  CERTBOT_BIN="$(command -v certbot || true)"
fi
[[ -n "${CERTBOT_BIN}" && -x "${CERTBOT_BIN}" ]] || fail "O Certbot não foi encontrado."

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  issue_certificate || fail "O Let’s Encrypt não respondeu após três tentativas. Aguarde alguns minutos e rode este mesmo comando novamente."
fi

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

for _ in $(seq 1 45); do
  npm_http_get "https://${DOMAIN}/" "${DOMAIN}" 1 "${DOMAIN}" >/dev/null 2>&1 && break
  sleep 1
done
npm_http_get "https://${DOMAIN}/" "${DOMAIN}" 1 "${DOMAIN}" >/dev/null || fail "O HTTPS foi criado, mas o site ainda não respondeu."

printf '\n\033[1;32mNova Era Venduss concluída com sucesso.\033[0m\n'
printf 'Site: https://%s\n' "${DOMAIN}"
