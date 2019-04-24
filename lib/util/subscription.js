'use strict';

const EventEmitter = require('events').EventEmitter;
const scamp          = require('../index.js');

class TruncBackoff {
    constructor (min, max, reset) {
        this._min = min;
        this._max = max;
        this._cur = min;
        this._reset = reset;
        this._lastAt = Date.now();
    }

    reset () {
        this._cur = this._min;
    }

    wait (cb) {
        if (this._reset && Date.now() - this._lastAt >= this._reset) {
            this._cur = this._min;
        }

        let dur = this._cur;
        this._cur = Math.min(this._max, dur * 2);

        setTimeout(() => {
            this._lastAt = Date.now();
            return cb();
        }, dur);
    }
}

class Subscription extends EventEmitter {
    constructor (address, fingerprint, filter) {
        super();
        this._address = address;
        this._fingerprint = fingerprint;
        this._conn = null;
        this._connecting = false;
        this._ready = false;
        this._filter = filter;
        this._backoff = new TruncBackoff(50, 10000);
        this._closed = false;

        this._reconnect();
    }

    _reconnect () {
        // console.log('RECONNECT');
        if (this._conn || this._closed) return;
        let conn = this._conn = scamp.client('beepish').create({
            address: this._address,
            fingerprint: this._fingerprint,
        });
        conn.subscribe(this._filter);
        conn.on('subscribe_done', () => {
            if (conn !== this._conn) return;
            this._backoff.reset();
            this._ready = true;
        });
        conn.setHeartbeat(15000);
        conn.on('lost', () => {
            if (conn !== this._conn) return;
            this._ready = false;
            this._conn = null;
            this._backoff.wait(() => this._reconnect());
        });
    }

    close () {
        // console.log('CLOSE');
        this._closed = true;
        if (this._conn) {
            this._conn.close();
        }
    }

    getSubdata (code, key) {
        return this._ready ? this._conn.getSubdata(code, key) : undefined;
    }

    get ready() {
        return this._ready;
    }
}

module.exports = Subscription;
