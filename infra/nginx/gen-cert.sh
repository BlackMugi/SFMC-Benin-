#!/bin/sh
# Certificat auto-signé (DEV uniquement) généré une fois dans le volume /etc/nginx/certs.
set -e
mkdir -p /etc/nginx/certs
if [ ! -f /etc/nginx/certs/tls.crt ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout /etc/nginx/certs/tls.key -out /etc/nginx/certs/tls.crt \
    -subj "/C=BJ/O=SFMC Benin/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi
