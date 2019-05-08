# scamp-js
Single Connection Asynchronous Multiplexing Protocol - Javascript edition.

SCAMP is a very simple protocol which is conceptually similar to HTTP 2, except that it has special abilities like uni-directional streams, discovery, and subscriptions.

This repository contains everything needed to create a nodejs SCAMP service

# Trivial Example

    # Start the test service
    docker run --rm -it gudtech/scamp-js


# Sample Dockerfile for myservice

```
FROM gudtech/scamp-js:latest

ARG SCAMPDB_VER
ENV SCAMPDB_VER=${SCAMPDB_VER}

ENV SCAMP_SERVICE_NAME=scamp-db

WORKDIR /service/
COPY lib /service/myservice/
COPY entrypoint.sh /service/myservice/entrypoint.sh

#TODO: Handle SCAMP params as envrionment variables
COPY scamp.conf /etc/scamp/scamp.conf

ENTRYPOINT ["/service/myservice/entrypoint.sh"]
```

# Sample entrypoint.sh for myservice

```
#!/bin/sh
set -e

/scamp/script/provision-service myservice
exec node ./myservice/service.js
```

# Sample service.js for myservice

```
'use strict';
var scamp = require('scamp');

var svc = scamp.service({
    tag: 'myservice',
});

svc.registerAction( 'Greetings.hello', svc.cookedHandler(function (header, data) {
    return {content: "Hello " + (data.name || "World")};
}));
```
