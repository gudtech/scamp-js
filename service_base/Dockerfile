FROM node:lts

ARG SCAMPJS_VER
ENV SCAMPJS_VER=${SCAMPJS_VER}
ENV SCAMP_CONFIG_DIR=/etc/scamp

RUN echo $SCAMPJS_VER

WORKDIR /scamp/
COPY package*.json /scamp/
RUN npm install
COPY . /scamp/

RUN mkdir -p /usr/local/lib/node/ && \
    ln -s /scamp/lib /usr/local/lib/node/scamp

WORKDIR /service/
COPY test_service test

ENTRYPOINT [ "/service/test/entrypoint.sh" ]
