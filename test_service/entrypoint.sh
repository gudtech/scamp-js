#!/bin/sh
set -e

mkdir -p "$SCAMP_CONFIG_DIR"
cp ./test/scamp.conf /etc/scamp/scamp.conf
/scamp/script/provision-service test
exec node ./test/service.js
