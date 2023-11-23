'use strict';
// scamp-js/lib/actor/requester.js

const scamp             = require('../index.js');
const Message         = scamp.module('handle/Message');
const requestErrorLog = new (scamp.LogSink())(
    'scamp_internal', 'request_error', 'date duration client_id action code message dispatched_address dispatched_ident dispatched_fingerprint');

class BoundServiceMgr {
    constructor (engine, sector) {
        this._engine = engine;
        this._sector = sector;
    }

    findAction (action, env, ver, ident) {
        return this._engine.findAction(this._sector, action, env, ver, ident);
    }

    on (evname, fn) {
        if (evname === 'changed') this._engine.on('changed', fn);
    }

    checkStale () {
        return this._engine.checkStale();
    }

    listActions () {
        return this._engine.listActions(this._sector);
    }
}

class Requester {
    constructor (params) {
        this._engine = params.engine;
        this.sector = params.sector;
        this.serviceMgr = new BoundServiceMgr(params.engine, params.sector);
    }

    makeRequest (params, body, callback) {
        let request   = new Message(params.header || {
            sector:   params.sector || this.sector,
            action:   params.action,
            envelope: params.envelope,
            version:  params.version,
            ticket:   params.ticket,
            terminal: params.terminal,
        }, body);

        this.forwardRequest({}, request, (err, rpy, service) => {
            if (rpy && service && rpy.header.error_data && rpy.header.error_data.dispatch_failure &&
                    !params.retried && !params.ident) {

                // TODO: we might consider being smarter about this.
                scamp.error(`Failed to dispatch ${params.action} to ${service.address}, redispatching...`);
                service.registration.connectFailed();
                params.retried = true;
                return this.makeRequest(params, body, callback);
            }
            return callback(err, rpy, service);
        });
    }

    forwardRequest (params, request, onrpy) { // does apply aliases
        let info = this._engine.findAction(request.header.sector || this.sector, request.header.action, request.header.envelope, request.header.version, params.ident);
        if (!info) {
            if (this._engine.checkStale())
                return onrpy(new Error(`No valid action index: ${this._engine.checkStale()}`), null);
            return onrpy(new Error(`Action ${request.header.action} not found`), null);
        }

        request.header.action  = info.action;
        request.header.version = info.version;

        let client = this._engine.getClient(info.address, info.fingerprint);
        if (!client) return onrpy(new Error(`bad service address: ${info.address}`), null);

        client.request({ timeout: params.timeout || info.timeout }, request,
            (err, rpy) => onrpy(err, rpy, info.service));
    }

    makeJsonRequest (header, payload, callback) {
        header.envelope || (header.envelope = 'json');
        header.version || (header.version = 1);

        var started = new Date();
        var log_error = function(code, message, service) {
            requestErrorLog.log({
                date: started.toISOString(),
                duration: (Date.now() - started) / 1000,
                client_id: header.header ? header.header.client_id : header.client_id,
                action: header.header ? header.header.action : header.action,
                code: code,
                message: message,
                dispatched_address: service ? service.address : '',
                dispatched_ident: service ? service.ref.ident : '',
                dispatched_fingerprint: service ? service.fingerprint : ''
            });
        };

        this.makeRequest( header, Buffer.from( JSON.stringify(payload)) , function response( err, scamp_res, service ) {
            if(err){
                // TODO: add an 'internal_error' so it doesn't call 'drain'?
                scamp.errorInternal('internal request failed',err);
                log_error('transport', err.toString(), service);

                return callback('transport', err.toString(), null);
            } else {
                scamp_res.readAll(function(code, msg, resp) {
                    if (code) {
                        log_error(code, msg, service);
                    }
                    callback.apply(null, arguments);
                });
            }
        });
    }
}

module.exports = Requester;
