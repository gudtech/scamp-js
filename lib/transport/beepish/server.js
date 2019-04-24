'use strict';
const tls = require('tls');
const scamp = require('../../index.js');
const Message = require('../../handle/Message.js');
const conn = require('./connection.js');
const EventEmitter = require('events').EventEmitter;

class ServerConnection {
    constructor(cleartextStream, server) {
        this.proto = conn.wrap(cleartextStream);
        this.proto.setBaseTimeout( scamp.config().val('beepish.server_timeout', 120) * 1000 );
        this.count = 0;
        this.filter = null;
        this.server = server;
        this.id = this.server.next_id++;

        this.proto.on('lost', () => {
            this.server.setFilter(this, null, () => {});
        });

        this.proto.on('message', (req) => {
            switch (req.header.type) {
                case 'request':
                let id = req.header.request_id;
                if (id === undefined) return scamp.error('Received request with no request_id');
                this.count++; this.proto.setBusy(!!this.count);

                server.params.callback(req, (rpy) => {
                    rpy.header.type = 'reply';
                    rpy.header.request_id = id;
                    this.count--; this.proto.setBusy(!!this.count);
                    this.proto.sendMessage(rpy);
                });
                break;

                case 'subscribe':
                req.readAll((ecode, err, data) => {
                    if (ecode) return;
                    this.server.setFilter(this, data, success => {
                        this.proto.sendMessage(new Message({ request_id: req.header.request_id, type: 'subscribe_done' }, success));
                    });
                });
                break;

                case 'notify':
                req.readAll((ecode, err, data) => {
                    if (ecode) return;
                    this.server.emit('notify',this,data);
                });
                break;

                default:
                return scamp.error('Unknown incoming message type');
            }
        });

        this.proto.start();
    }

    sendEvent (data) {
        this.proto.sendMessage(new Message(
            { type: 'event' },
            data
        ));
    }

    setHeartbeat (msecs) {
        this.proto.setHeartbeat(msecs);
    }
}

class Server extends EventEmitter {
    constructor(params) {
        super();
        this._tlssrv = {};
        this.params = params;
        this.next_id = 1;
        this._subscribed_connections = new Map();
        this._subdata = new Map();

        for (let addr of scamp.config().busInfo().service) {
            this._listen(addr, params);
        }
    }

    setFilter(conn, filter, cb) {
        if (filter instanceof Array && filter.every(ff => typeof ff === 'string') && filter.length <= 10) {
            this._subscribed_connections.set(conn.id, { conn, filter });
            let evout = [];
            for (let code of filter) {
                let data = this._subdata.get(code) || new Map();
                for (let key of data.keys()) {
                    evout.push({ code, key, value: data.get(key) });
                }
            }
            conn.sendEvent(evout);
            return cb(true);
        } else {
            this._subscribed_connections.delete(this.id);
            return cb(filter === null);
        }
    }

    notify (data) {
        for (let inf of this._subscribed_connections.values()) {
            if (inf.filter.indexOf(data[0].code) >= 0) {
                inf.conn.sendEvent(data);
            }
        }
    }

    putSubdata (code, key, value) {
        value = JSON.stringify(value);
        if (!value) throw 'value must be JSONable';
        value = JSON.parse(value);
        if (typeof key !== 'string') throw 'key must be a string';
        if (typeof code !== 'string') throw 'code must be a string';

        if (!this._subdata.get(code)) {
            this._subdata.set(code, new Map());
        }
        let old = this._subdata.get(code).get(key);
        if (old === undefined) { old = null; }
        if (old === value) { return; }
        if (value === null) {
            this._subdata.get(code).delete(key);
        } else {
            this._subdata.get(code).set(key, value);
        }
        this.notify([{ code, key, value }]);
    }

    _listen (addr, params) {
        let srv = this._tlssrv[addr] = tls.createServer({
            key:  params.key,
            cert: params.cert,
        }, (cleartextStream) => {
            new ServerConnection(cleartextStream, this);
        });

        let tries = scamp.config().val('beepish.bind_tries', 20);

        let listen = () => {
            let pmin = scamp.config().val('beepish.first_port', 30100);
            let pmax = scamp.config().val('beepish.last_port', 30399);
            let port = pmin + Math.floor(Math.random() * (pmax - pmin + 1));

            if (tries-- <= 0)
                scamp.fatal('Could not bind beepish-server socket');

            srv.listen( port, addr, () => {
                params.listen( addr, `beepish+tls://${addr}:${port}` );
            });
        };

        srv.on('error', function (e) {
            if (e.code == 'EADDRINUSE') {
                listen();
            } else {
                scamp.error(e);
            }
        });

        listen();
    }
}

exports.create = function (p) { return new Server(p); };
