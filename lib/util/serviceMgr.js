'use strict';
// scamp-js/lib/util/serviceMgr.js

var scamp        = require('../index.js'),
    util       = require('util'),
    crypto     = require('crypto'),
    EventEmitter = require('events').EventEmitter,
    serviceCls = scamp.module('handle/service');

var timeoutMultiplier = 2.1;

exports.create = function(params){ return new Manager(params) }

function Registration(mgr,svc) {
    EventEmitter.call(this);

    this._failures = [];
    this._reactivateTime = -Infinity;
    this.service = svc;
    this.manager = mgr;
}
util.inherits(Registration, EventEmitter);

Registration.prototype.refresh = function () {
    if (this.timer) clearTimeout( this.timer );

    this.active(true);
    if (this.permanent) return;
    this.timer = setTimeout(() => this.active(false), parseInt( this.service.sendInterval ) * timeoutMultiplier );
};

Registration.prototype.isActive = function () {
    return this.service && this.manager._registry[this.service.workerIdent] === this;
}

Registration.prototype.active = function (state) {
    if (this.service) {
        this.manager._index(this, state);
        this.manager.emit('changed');
    }
};

Registration.prototype.connectFailed = function () {
    var now = Date.now();

    while (this._failures.length && this._failures[0] < (now - 86400 * 1000)) this._failures.shift();
    this._failures.push(now);

    var minutes = Math.min(60, this._failures.length);
    this._reactivateTime = now + 60*1000 * minutes;
    scamp.error('Marking',this.service.workerIdent,'"failed" for',minutes,'minutes');
};

Registration.prototype.isFailed = function () {
    return Date.now() < this._reactivateTime;
};

// Yo, I AM Your manager, B!
function Manager( params ){
    EventEmitter.call(this);

    this._registry = {};
    this._seenTimestamps = {};
    this._invalid = false;

    this._actionIndex   = {};

    if (params.cached) this._loadCache();
}
util.inherits(Manager, EventEmitter);

Manager.prototype._loadCache = function() {
    var path = scamp.config().val('discovery.cache_path');
    var limit = scamp.config().val('discovery.cache_max_age', 120);
    var fs = require('fs');

    try {
        let stat = fs.statSync(path);
        if (Date.now() - stat.mtime.getTime() > 1000 * limit) throw 'Stale discovery cache';
    } catch (e) {
        this._invalid = String(e);
        return;
    }

    var buf = fs.readFileSync(path, 'utf8');
    var chunks = buf.split(/\n%%%\n/);
    chunks.shift();

    var oldRegs = new Set();
    var oldRegsByBlob = new Map();
    for (var name in this._registry) {
        var reg = this._registry[name];
        oldRegs.add(reg);
        oldRegsByBlob.set(reg.blob, reg);
    }

    var seen = new Set();
    for (var i = 0; i < chunks.length; i++) {
        if (seen.has(chunks[i])) continue;
        seen.add(chunks[i]);

        var sameReg = oldRegsByBlob.get(chunks[i]);
        if (sameReg) {
            oldRegs.delete(sameReg);
            continue;
        }

        var reg = this.registerService(chunks[i], true);
        if (reg) {
            oldRegs.delete(reg);
        }
    }

    for (var rreg of oldRegs) {
        rreg.active(false);
    }

    this._invalid = false;
};

Manager.prototype.registerService = function(blob, permanent) {
    //console.log('received data ' + blob.toString());

    //var start = (new Date).getTime();
    try{
        var chunks = blob.toString('binary').split('\n\n');
        var data = chunks[0];
        var cert = chunks[1] + '\n';
        var sig  = new Buffer(chunks[2], 'base64');

        var cert_der = new Buffer(cert.toString().replace(/---[^\n]+---\n/g,''), 'base64');
        var sha1 = crypto.createHash('sha1').update(cert_der).digest('hex');
        var fingerprint = sha1.replace(/..(?!$)/g, '$&:').toUpperCase();

        if (!crypto.createVerify('sha256').update(data).verify(cert.toString(), sig))
            throw 'Invalid signature';

        var reg = this.registerService2( data, fingerprint, permanent );
        if (reg) reg.blob = blob;
        return reg;
    } catch(e){
        scamp.error('Failed to parse announcement', e, e.stack );
    }
    //console.log('parseRef took', (new Date).getTime() - start , 'ms');
};

// permanent disables all timestamp logic, used when talking to a scoreboard file or circular server
Manager.prototype.registerService2 = function( text, fingerprint, permanent ){
    var key = fingerprint + '$' + text;

    var svinfo = serviceCls.create( text, fingerprint );
    svinfo.permanent = permanent;
    if (svinfo.badVersion || svinfo.weight == 0) return; // not for us
    if (!permanent && svinfo.timestamp < this._seenTimestamps[svinfo.workerIdent]) throw "timestamp "+svinfo.timestamp+" is not the most recent for "+svinfo.workerIdent;
    this._seenTimestamps[svinfo.workerIdent] = svinfo.timestamp;

    var reg = this._registry[ svinfo.workerIdent ];

    if (reg) {
        reg.active(false);
        reg.service = svinfo;
        svinfo.registration = reg;
        reg.refresh();
    } else {
        reg = new Registration(this, svinfo);
        reg.permanent = permanent;
        svinfo.registration = reg;
        reg.refresh();
    }
    this.emit('changed');
    return reg;
};

Manager.prototype.listServices = function () {
    let out = [];
    for (let ident in this._registry) {
        out.push(this._registry[ident].service);
    }
    return out;
};

Manager.prototype._baseIndex = function (index, key, service, info) {
    var ref, name;

    key = key.toLowerCase();
    //console.log('+', (info ? 'Reg' : 'Dereg') + 'istrating', key);
    if (info) {
        ref = index[key] = index[key] || { };
        ref[ service ] = info;
    } else {
        ref = index[key];
        if (!ref) return;
        delete ref[service];
        for (name in ref) { if (ref.hasOwnProperty(name)) return; }
        // if there is nothing left in ref, remove the key
        delete index[key];
    }
};

var alias_tags = ['create', 'read', 'update', 'destroy'];

Manager.prototype._index = function (reg, insert) {
    let service = reg.service;
    let name = service.workerIdent;

    if (insert) {
        if (this._registry[name] === reg) return;
        if (this._registry[name]) this._index(this._registry[name], false);
        this._registry[name] = reg;
    }
    else {
        if (this._registry[name] !== reg) return;
        delete this._registry[name];
    }
    //console.trace((insert ? 'Reg' : 'Dereg') + 'istrations for', name, service.actions.length);

    service.actions.forEach((info) => {
        if (info.sector.indexOf(':') >= 0 || info.name.indexOf('.') >= 0) return;
        var aname   = info.namespace + '.' + info.name;
        var block   = [ name, reg, aname, info.version, info.flags, info.envelopes, info.sector ];

        this._baseIndex(this._actionIndex, info.sector + ':' + aname + '.v' + info.version, name, insert && block);

        block[4].forEach((crud_tag) => {
            if (alias_tags.indexOf(crud_tag) >= 0)
                this._baseIndex(this._actionIndex, info.sector + ':' + info.namespace + '._' + crud_tag + '.v' + info.version, name, insert && block);
        });
    });
};

Manager.prototype.checkStale = function () { return this._invalid; };

Manager.prototype.findAction = function( sector, action, envelope, version, ident) {
    if( typeof sector !== 'string' ) throw "sector is required";
    if( !action   ) throw "action is required";
    if( !envelope ) throw "protocol is required";
    version = Number(version) || 1;

    var list = this._actionIndex[ sector + ':' + String(action).toLowerCase() + '.v' + version ]; // XXX name mangling
    if(!list) return null;

    var filtered = [],
        failing = [],
        item;

    // this is a little bit weak sauce
    Object.keys(list).forEach(k => {
        let block = list[k];
        if (!block[1].service.authorized(block[6], block[2]))
            return;

        if (block[5].indexOf(envelope) >= 0 && (!ident || ident == block[1].service.workerIdent)) {
            (block[1].isFailed() ? failing : filtered).push(list[k]);
        }
    });

    if( filtered.length == 0 ) filtered = failing;
    if( filtered.length == 0 ) return null;

    item = filtered[ Math.floor( Math.random() * filtered.length ) ];

    var timeout = scamp.config().val('rpc.timeout', 75);
    item[4].forEach( function (f) { if (/^t\d+$/.test(f)) timeout = +f.substring(1); } );
    return {
        action: item[2],
        version: item[3],
        flags: item[4],
        address: item[1].service.address,
        fingerprint: item[1].service.fingerprint,
        service: item[1].service,
        timeout: timeout * 1000,
    };
};

Manager.prototype.listActions = function (sector) {
    let actions = [];

    for (let key of Object.keys(this._actionIndex).sort()) {
        let name, block;
        for (name in this._actionIndex[key]) { block = this._actionIndex[key][name]; break; }
        if (block[6] !== sector) continue;

        actions.push([block[2], block[3]]);
    }

    return actions;
};
