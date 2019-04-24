'use strict';

var scamp        = require('../index.js'),
    inherits     = require('util').inherits,
    service      = scamp.module('handle/service'),
    fs           = require('fs'),
    EventEmitter = require('events').EventEmitter,
    path         = require('path');

exports.create = function(params) { return new Observer(params) };

function Observer ( params ){
    var me = this;

    EventEmitter.call(this);
    var ts;

    if(!params.serviceMgr) throw "serviceMgr is required";
    me.serviceMgr = params.serviceMgr;
    var cache_path = main.config().val('discovery.cache_path');

    var check = function (event, filename) {
        // No need to reload the cache unless cache_path is the file that changed
        if (typeof filename != 'undefined' && filename != path.basename(cache_path)) {
            return;
        }

        try {
            var nts = +fs.statSync(cache_path).mtime;
            if (nts === ts) return;
            ts = nts;
            me.serviceMgr._loadCache();
        } catch(e) {
            // cache_path may not accessible briefly while being updated and statSync
            // throws an error even though it's supposed to be tolerant of files not existing,
            // so let's not spam the logs in that case.
            if (e.code != 'ENOENT') console.log(e);
            return;
        }
    };
    check();
    fs.watch(path.dirname(cache_path), check);
}
inherits(Observer, EventEmitter);
