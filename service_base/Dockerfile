FROM node:lts-alpine

ENV SCAMP_CONFIG_DIR /etc/SCAMP

COPY service_base/provision-service /

WORKDIR /service/
COPY package*.json ./
COPY script/testservice.js test_service/service.js

RUN npm install

COPY . .

CMD [ "node", "test_service/service.js" ]