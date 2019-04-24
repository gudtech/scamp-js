'use strict';
const conn = require('./connection.js');
const tls  = require('tls');
const scamp  = require('../../index.js');
const url =  require('url');
const Message = require('../../handle/Message.js');
const EventEmitter = require('events').EventEmitter;

exports.create = function (params) { return new Client(params); };

class Client extends EventEmitter {
    constructor (params) {
        super();
        let info = url.parse(params.address);
        let proto;
        let started;

        let clear = tls.connect({
            host: info.hostname,
            port: info.port,
            rejectUnauthorized: false
        }, () => {
            this.adjTimeout();

            let cert = clear.getPeerCertificate() || {};
            scamp.debug('connection:',cert.fingerprint);
            scamp.debug('expect:',params.fingerprint);

            if (params.fingerprint && cert.fingerprint !== params.fingerprint) {
                return proto._onerror(true, `TLS FINGERPRINT MISMATCH: announce=${params.fingerprint} peer=${cert.fingerprint}`);
            }

            started = true;
            proto.start();
        });

        proto = this._proto = conn.wrap(clear);
        proto.setBaseTimeout( scamp.config().val('beepish.client_timeout', 90) * 1000 );
        clear.setTimeout( 10000 );

        this._pending = new Map();
        this._correlation = 1;
        this._info = info;
        this._sdata = new Map();

        proto.on('message', (rpy) => {
            switch (rpy.header.type || 'reply') {
                case 'reply':
                if (!rpy.header.request_id) return scamp.error('Received reply with no request_id');
                this._call( rpy.header.request_id, null, rpy );
                break;

                case 'event':
                rpy.readAll((ecode, error, data) => this.onEvent(data));
                break;

                case 'subscribe_done':
                rpy.readAll((ecode, error, data) => {
                    this.emit('subscribe_done');
                });
                break;

                default:
                scamp.error(`Received unexpected type ${rpy.header.type}`);
                break;
            }
        });

        proto.on('lost', () => {
            this.emit('lost');
            for (let id of this._pending.keys()) {
                let msg = new Message(started ?
                    { error_code: 'transport', error: 'Connection lost' } :
                    { error_code: 'transport', error: 'Connection could not be established', error_data: { dispatch_failure: true } });
                process.nextTick(() => msg.end());
                this._call( id, null, msg );
            }
        });
    }

    notify (data) {
        this._proto.sendMessage(new Message({ type: 'notify' }).slurp(data));
    }

    subscribe (filter) {
        let corr = this._correlation++;
        this._proto.sendMessage(new Message({ type: 'subscribe', request_id: corr }, filter));
    }

    getSubdata (code, key) {
        if (!this._sdata.get(code)) return null;
        let v = this._sdata.get(code).get(key);
        return v === undefined ? null : v;
    }

    onEvent (data) {
        if (!(data instanceof Array)) {
            scamp.error('received invalid event data, not list');
            return;
        }
        for (let rec of data) {
            if (!rec || typeof rec !== 'object' || typeof rec.code !== 'string' || typeof rec.key !== 'string' || !('value' in rec)) {
                scamp.error('Unparsable event record');
                continue;
            }
            if (!this._sdata.get(rec.code)) this._sdata.set(rec.code, new Map());
            if (rec.value === null) {
                this._sdata.get(rec.code).delete(rec.key);
            } else {
                this._sdata.get(rec.code).set(rec.key, rec.value);
            }
        }
    }

    _call (id, err, rpy) {
        let rec = this._pending.get(id);
        if (!rec) return;
        this._pending.delete(id);
        this.adjTimeout();
        clearTimeout(rec.t);
        rec.cb(err, rpy);
    }

    request (params, request, callback) {
        let id = request.header.request_id = this._correlation++;
        request.header.type = 'request';
        let tmout = () => {
            // instruct connection manager to open a new connection, this one is now suspect
            this.emit('lost');
            this._call(id, new Error("RPC Timeout (request " + id + ")"), null);
        };

        this._pending.set(id, {
            cb: callback,
            t:  setTimeout( tmout, params.timeout + 5000 ),
        });
        this.adjTimeout();
        this._proto.sendMessage(request);
    }

    adjTimeout () {
        this._proto.setBusy(this._pending.size > 0);
    }

    setHeartbeat (msecs) {
        this._proto.setHeartbeat(msecs);
    }
}
