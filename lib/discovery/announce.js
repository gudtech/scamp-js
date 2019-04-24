'use strict';
/*

=head1 NAME

discovery/announce.js - generate announcements for SCAMP services

=head1 DESCRIPTION

Posts announcements to the ZeroMQ multicase bus at regular intervals.

=head1 EXPORTED FUNCTIONS

=head2 create(params)

Creates an announcer object and automatically begins announcing.

=over

=item B<params.ident>

A string identifying the service, like "auth"

=item B<params.serviceAddress>

A public address for this worker (transport specific)

=item B<params.sendInterval>

Milliseconds between announcments; defaults to 5000

=item B<params.weightValue>

Relative capacity of this node; defaults to 1

=item B<params.classes>

Hash of class descriptors (TODO document format)

=item B<params.envelopeTypes>

List of supported envelope types

=back

=head1 METHODS

=head2 start()

Resumes announcements after a suspend.

=head2 suspend()

Suspends normal announcements and begins sending special negative
announcements to explicitly tell clients that this node is, at least
temporarily, unavailable.

=head2 setWeight(newWeight)

Replace the value that was passed as B<params.weightValue>.

=head2 setClasses(newClasses)

Replace the value that was passed as B<params.classes>.

=head2 setInterval(newInterval)

Replace the value that was passed as B<params.sendInterval>.

=cut

*/
'use strict';
const scamp = require('../index.js');
const dgram = require('dgram');
const zlib  = require('zlib');
const crypto = require('crypto');
const info  = scamp.config().busInfo();
const EventEmitter = require('events').EventEmitter;

exports.create = function(params) { return new Announcer(params) };

class Announcer extends EventEmitter {
    constructor (params) {
        super();
        if(!params.ident) throw "ident is required";
        if(!params.sector) throw "sector is required";
        if(!params.key) throw "key is required";
        if(!params.cert) throw "cert is required";
        this.ident    = params.ident;
        this.sector   = params.sector;
        this.serviceAddress = {};

        this.sendInterval = params.sendInterval  || 5000;
        this.weightValue  = params.weightValue   || 1;

        this._classes     = params.classes      || {};
        this._extend      = params.extend       || {};
        this.envelopeTypes = params.envelopeTypes || [];
        this.key = params.key;
        this.cert = params.cert;

        this.pubSocks = [];
        this.start();

        for (let a of info.discovery) {
            a = a.trim();
            let sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            sock.on('listening', () => {
                this.pubSocks.push(sock);
                scamp.info( `Service announcer bound to ${a} ${info.port} (multicast)` );
            });

            sock.bind(info.port, a);
        }
    }
}

Announcer.prototype.setWeight = function(weight){
    this.weightValue = weight;
    this._packet = {};
};
Announcer.prototype.setExtend = function(extend) {
    this._extend = extend;
    this._packet = {};
};
Announcer.prototype.setClasses = function( classes ){
    var me = this;
    me._classes = classes;
    me._packet = {};
};
Announcer.prototype.addAddress = function( iface, uri ){
    var me = this;
    me.serviceAddress[iface] = this.lastServiceAddress = uri;
    me._packet = {};
};
Announcer.prototype.getCompiledClasses = function(){
    var me = this;

    var classStr, classObj,
        actionStr,  action,
        actionList,
        classList = [];

    for( classStr in me._classes ){
        classObj = me._classes[classStr];

        var classNode = [ classStr ];
        for (actionStr in classObj ){
            action = classObj[actionStr];
            classNode.push(action);
        }
        if(classNode.length > 1) classList.push( classNode );
    }
    return classList;
};

Announcer.prototype.start = function(){
    var me = this;
    me._suspended = false;
    me._packet = {};
    me.send();
    clearInterval( me._suspendInterval );
    me._interval = setInterval( function() { me.send() }, me.sendInterval );
};
Announcer.prototype.suspend = function(){
    var me = this;
    if(me._suspended) return;

    me._suspended = true;
    me._packet = {};
    clearInterval(me._interval);
    me.send();

    var ct = 0;
    me._suspendInterval = setInterval(function(){
        me.send();
        if( ++ct > 3 ) clearInterval( me._suspendInterval );
    }, 200 );
};
Announcer.prototype.send = function(){
    var me = this;
    return me.pubSocks.forEach(function (sock) {
        me._makePacket(sock.address().address, function (pkt) {
            sock.send( pkt, 0, pkt.length, info.port, info.group );
        });
    });
};
Announcer.prototype._makePacket = function(addy, cb){
    var me = this;
    if (me._packet[addy]) return cb(me._packet[addy]);
    me._packet[addy] = false;

    let address = me.serviceAddress[addy] || this.lastServiceAddress;
    var blob = JSON.stringify([
        3, // version
        me.ident,
        me.sector,
        me._suspended ? 0 : me.weightValue,
        me.sendInterval,
        address,
        me.envelopeTypes.concat(me._extend),
        (me._suspended || !address) ? [] : me.getCompiledClasses(),
        Date.now(),
    ]);

    var sig = crypto.createSign('sha256').update(blob).sign( me.key, 'base64' ).replace(/.{1,76}/g, "$&\n");
    var uc = blob + '\n\n' + me.cert + '\n' + sig + '\n';
    this.emit('made_packet', uc);

    return zlib.deflate(uc, function (err, comp) {
        if (err) throw err; // wtf?  out of memory or something?
        if (me._packet[addy] !== false) return me._makePacket(addy,cb); //invalidation race
        return cb( me._packet[addy] = comp );
    });
};
