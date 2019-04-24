'use strict';
const scamp    = require('../lib/index.js');
const dgram  = require('dgram');
const zlib   = require('zlib');
const crypto = require('crypto');
const fs     = require('fs');
const url    = require('url');
const service = scamp.module('handle/service');
const argp   = require('argparser').vals('pidfile','scoreboard').parse();

if (argp.opt('pidfile'))
    fs.writeFileSync(argp.opt('pidfile'), process.pid);

process.on('SIGINT', function() {
    console.log('cache-manager: received SIGINT; exiting');
    process.exit(0);
});
process.on('SIGTERM', function() {
    console.log('cache-manager: received SIGTERM; exiting');
    process.exit(0);
});

function Peering() {
    var me = this;
    me._port = 55436;
    var info = me.info = scamp.config().busInfo();
    me._myHost = info.service[0];

    me.sock = dgram.createSocket('udp4');
    me.sock.bind( me._port, me._myHost );

    me.sock.on( 'message', function(blob, rinfo) {
        //console.log('got peer packet',rinfo.address,rinfo.size,crypto.createHash('md5').update(blob).digest('hex'));
        me._sawHost[rinfo.address] = Date.now();
        if (blob.length > 1) {
            if (blob.toString('binary',0,1) == 'X') {
                var hint = blob.toString('utf8',1);
                hint.split(' ').forEach(function (h) { me._hintedHost[h] = Date.now(); });
            } else {
                setTimeout(function () { me.onMessage(blob); }, 200 + Math.random() * 300); // delay a bit so multicast can win the race
            }
        }
    });

    me._sawHost = {};
    me._hintedHost = {};
    me._sendTime = {};

    me._pubSocks = [];

    info.discovery.forEach(function (a) {
        a = a.trim();
        var sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        sock.on('listening', function () {
            me._pubSocks.push(sock);
        });

        sock.bind(info.port, a);
    });
    setInterval(me.netKeepalive.bind(me), 10000);
}

Peering.prototype.localAddresses = function () {
    if (this._localAddressesUntil >= Date.now())
        return this._localAddresses;

    this._localAddressesUntil = Date.now() + 300e3;
    this._localAddresses = {};
    var me = this;
    var iff = require('os').networkInterfaces();
    Object.keys(iff).forEach(function (ifn) {
        iff[ifn].forEach(function (a) { me._localAddresses[a.address] = true; });
    });
    //console.log('local addresses',Object.keys(this._localAddresses));
    return this._localAddresses;
};

Peering.prototype.netKeepalive = function () {
    // If we don't have any services, send an empty packet to all known hosts every 10 seconds to keep connectivity alive

    var me = this;
    var now = Date.now();
    //console.log('keepalive cycle');
    var msg = new Buffer('X' + me.knownHosts().join(' '));
    me.knownHosts(true).forEach(function (a) {
        //console.log('send keepalive to',a);
        me.sock.send(msg, 0, msg.length, me._port, a);
        me._sendTime[a] = now;
    });
};

Peering.prototype.knownHosts = function (with_seeds) {
    var me = this;
    var out = {};
    var cut = Date.now() - 300e3;
    Object.keys(me._sawHost).forEach(function (h) {
        if (me._sawHost[h] >= cut) out[h] = h;
    });
    if (with_seeds) {
        Object.keys(me._hintedHost).forEach(function (h) {
            if (me._hintedHost[h] >= cut) out[h] = h;
        });
        scamp.config().val('discovery.seed_hosts','').split(/\s+/).forEach(function (h) {
            if (h) out[h] = h;
        });
    }
    var la = me.localAddresses();
    out = Object.keys(out).filter(function (a) { return !la[a]; });
    //console.log('known hosts',out);
    return out;
};

Peering.prototype.multicast_in = function (blob,addr) {
    //console.log('saw multicast',addr,require('url').parse(addr).hostname,crypto.createHash('md5').update(blob).digest('hex'));
    let host = url.parse(addr).hostname;

    if (host === '127.0.0.1') return; // nobody else can use these
    if (this.localAddresses()[host]) {
        //console.log('locally originated');
        this.knownHosts().forEach(a => {
            //console.log('republish to',a);
            this.sock.send(blob, 0, blob.length, this._port, a);
            this._sendTime[a] = Date.now();
        });
    }
};

function CacheFile(path) {
    this.contents     = new Buffer(0);
    this._path        = path;
    this._maxAge      = scamp.config().val('discovery.cache_max_age', 120);
    try {
        // If the cache manager is being restarted but the cache is not stale, don't rewrite it immediately but let the announces come in first
        if (fs.statSync(path).mtime.getTime() >= Date.now() + 10000 - this._maxAge * 900) {
            this._suspended = true;
            setTimeout(() => {
                this._suspended = false;
                this._write();
            }, 10000);
        }
    } catch (e) {}
}

CacheFile.prototype.update = function (contents) {
    if (String(contents) == String(this._contents)) return;
    this._contents = contents;

    if (!this._suspended) this._write();
};

CacheFile.prototype._write = function () {
    fs.writeFileSync(this._path + '.new', this._contents);
    fs.renameSync(this._path + '.new', this._path);

    this._touch(false); // reset timer
};

CacheFile.prototype._touch = function (real) {
    if (real) fs.utimesSync(this._path, new Date(), new Date());

    clearTimeout(this._timeout);
    var me = this;
    this._timeout = setTimeout(function () { me._touch(true); }, this._maxAge * 500);
};



function CacheBag() {
    this._file = new CacheFile(argp.opt('scoreboard') || scamp.config().val('discovery.cache_path'));
    if (scamp.config().val('discovery.auth_localhost','')) {
        this._afile = new CacheFile(scamp.config().val('bus.authorized_services'));
    }
    this._bag = {};
    this._bagByContent = {};
    this._timeouts = {};
}

CacheBag.prototype.register = function (ttl, key, data) {
    key = '$' + key;

    if (/\n%%%\n/.test(data.blob)) throw "Illicit separator contained in blob"; // if the blob is totally well-formed this is impossible anyway

    clearTimeout(this._timeouts[key]);
    this._timeouts[key] = setTimeout(() => {
        if (!this._bag[key]) return;
        delete this._bagByContent[this._bag[key].string];
        delete this._bag[key];
        this._issue();
    }, ttl);

    if (this._bag[key] === data) {
        return;
    }
    if (this._bag[key]) {
        delete this._bagByContent[this._bag[key].string];
    }
    this._bag[key] = data;
    this._bagByContent[data.string] = data;
    this._issue();
};

CacheBag.prototype.hasByContent = function (content) {
    return this._bagByContent[content.toString('binary')];
};

CacheBag.prototype._issue = function() {
    var cat = [];
    var by_ident = {};
    var auth_localhost = !!scamp.config().val('discovery.auth_localhost','');

    Object.keys(this._bag).sort().forEach(k => {
        cat.push(new Buffer('\n%%%\n'));
        cat.push(this._bag[k].blob);
        let parsed = this._bag[k].parsed;
        let fingerprint = parsed.fingerprint;
        (by_ident[fingerprint] || (by_ident[fingerprint] = [])).push(parsed);
    });

    var acat = '';
    // LATER: use this in non-dev modes to populate authorized_services file based on service tickets
    if (auth_localhost) {
        Object.keys(by_ident).sort().forEach(fp => {
            let used_sectors = {};
            by_ident[fp].forEach(svc => {
                if (url.parse(svc.address).hostname !== '127.0.0.1') return;
                svc.actions.forEach(action => used_sectors[action.sector] = true);
            });
            let list = Object.keys(used_sectors).sort().map(sec => sec + ':ALL').join(', ');
            if (list) {
                acat += fp + '\t' + list + '\n';
            }
        });
    }

    this._file.update(Buffer.concat(cat));
    if (this._afile) this._afile.update(new Buffer(acat));
};



var seen_timestamps = {};

function Observer() {
    var info = scamp.config().busInfo();
    var peering = new Peering();

    this.subSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.subSock.bind( info.port, info.group, function () {
        info.discovery.forEach(function (a) { this.subSock.addMembership( info.group, a ) }, this);
    }.bind(this));

    this.bag = new CacheBag();

    me.subSock.on( 'message', function(blob) {
        if (me.announceGate) { return; }
        zlib.inflate(blob, function (err, ublob) {
            var addr = me.parseText( err ? blob : ublob );
            if (addr) peering.multicast_in(blob, addr);
        });
    });

    peering.onMessage = function (blob) {
        zlib.inflate(blob, function (err, ublob) {
            var addr = me.parseText( err ? blob : ublob );
        });
    };
}

Observer.prototype.parseText = function (blob) {
    //console.log('received data ' + data.toString());

    //var start = (new Date).getTime();
    let existing = this.bag.hasByContent(blob);
    try{
        if (existing) {
            return this.parseRef(existing);
        }
        var chunks = blob.toString('binary').split('\n\n');
        var data = chunks[0];
        var cert = chunks[1] + '\n';
        var sig  = new Buffer(chunks[2], 'base64');

        var cert_der = new Buffer(cert.toString().replace(/---[^\n]+---\n/g,''), 'base64');
        var sha1 = crypto.createHash('sha1').update(cert_der).digest('hex');
        var fingerprint = sha1.replace(/..(?!$)/g, '$&:').toUpperCase();

        if (!crypto.createVerify('sha256').update(data).verify(cert.toString(), sig))
            throw 'Invalid signature';

        return this.parseRef( null, blob, data, fingerprint );
    } catch(e){
        console.log('Parse error', e, blob.toString());
    }
    //console.log('parseRef took', (new Date).getTime() - start , 'ms');
};

Observer.prototype.parseRef = function( existing, blob, json, fingerprint ){

    let parsed = existing ? existing.parsed : service.create(json, fingerprint);

    if (parsed.timestamp < seen_timestamps[parsed.workerIdent])
        throw `timestamp ${parsed.timestamp} is not the most recent for ${parsed.workerIdent}`;

    seen_timestamps[parsed.workerIdent] = parsed.timestamp;

    this.bag.register(parsed.sendInterval * 2.1, parsed.workerIdent, existing || { blob: blob, parsed: parsed, string: blob.toString('binary') });
    return parsed.address;
};

var o = new Observer();
