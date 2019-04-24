FROM node:lts-alpine

RUN apk add --update openssl && \
    rm -rf /var/cache/apk/*

ENV SCAMP_CONFIG_DIR /etc/scamp

WORKDIR /scamp/
COPY package*.json /scamp/
RUN npm install
COPY . /scamp/
RUN mkdir -p /usr/local/lib/node/ && ln -s /scamp/lib /usr/local/lib/node/scamp

WORKDIR /service/
COPY test_service test

ENTRYPOINT [ "/service/test/entrypoint.sh" ]