
// scamp-js/lib/util/connectionMgr.js

var scamp        = require('../index.js');

module.exports = Manager;

// Yo, I AM Your manager, B!
function Manager( params ){
    var me = this;

    me._cache = {};
}

typeMap = {
    'beepish+tls': { transport: 'beepish' },
}
addrRe = /^([a-z0-9+]{2,15}):\/\/(.*)$/;

Manager.prototype.getClient = function( address, fingerprint ){
    var me     = this,
        client = me._cache[ address ];

    if( client ) return client;

    var match  = address.match(addrRe);
    if(!match) return null;

    var transportStr = match[1],
        ref          = typeMap[ transportStr ],
        i = 0, tr;

    if(!ref) return null;

    client = scamp.client( ref.transport ).create({
        address: address,
        fingerprint: fingerprint,
    });
    scamp.debug('Connect to', address );
    me._cache[ address ] = client;

    if (client.on) client.on('lost', function () {
        if (me._cache[address] === client) {
            console.log('--closed connection--', address);
            delete me._cache[address];
        }
    });

    return client;
}
