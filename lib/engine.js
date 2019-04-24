'use strict';
const scamp           = require('./index.js');
const EventEmitter  = require('events').EventEmitter;
const Subscription  = require('./util/subscription.js');

// Any app consuming the SCAMP has a single global requestor, a BEEPish listener, and zero or more services
class Engine extends EventEmitter {
    constructor () {
        super();
        this._connectionMgr = new (scamp.module('util/connectionMgr'))();
        this._serviceMgr = scamp.module('util/serviceMgr').create({ });
        this._observer   = scamp.module('discovery/observe').create({ serviceMgr: this._serviceMgr });
        this._serviceMgr.on('changed', () => this.emit('changed'));

        this.getClient = this._connectionMgr.getClient.bind(this._connectionMgr);
        this.findAction = this._serviceMgr.findAction.bind(this._serviceMgr);
        this.listActions = this._serviceMgr.listActions.bind(this._serviceMgr);
        this.listServices = this._serviceMgr.listServices.bind(this._serviceMgr);
        this.checkStale = this._serviceMgr.checkStale.bind(this._serviceMgr);
    }

    newSubscription (svc, filter) {
        return new Subscription(svc.address, svc.fingerprint, filter);
    }
}

module.exports = Engine;
