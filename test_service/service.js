'use strict';
var scamp = require('scamp');

var svc = scamp.service({
    tag: 'test',
});

svc.registerAction( 'Greetings.hello', svc.cookedHandler(function (header, data) {
    return {content: "Hello world"};
}));
