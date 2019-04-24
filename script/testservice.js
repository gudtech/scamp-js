'use strict';
var scamp = require('../lib');

var svc = scamp.service({
    tag: 'jstest',
});

svc.registerAction( 'Hello.jstest', svc.cookedHandler(function (header, data) {
    return {content: "Hello world"};
}));
