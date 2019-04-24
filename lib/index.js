
var util = require('util');

exports.module = function( name ) {
    return require('./' + name );
};
exports.util = function() {
    return require('./util');
}
exports.config = function() {
    return require('./util/config.js');
}
exports.logger = function() {
    return require('./logging/logger.js');
}
exports.LogSink = function() {
    return require('./logging/logsink.js');
}
exports.client = function( name ){
    return require('./transport/' + name + '/client.js' );
}
exports.server = function( name ){
    return require('./transport/' + name + '/server.js' );
}

var ENGINE;
exports.engine = function() {
    if (!ENGINE) ENGINE = new (require('./engine'))();
    return ENGINE;
}
exports.service = function(params){
    return require('./actor/service.js' ).create(params);
}
exports.requester = function(params){
    return new (require('./actor/requester.js' ))({ engine: this.engine(), sector: params.sector === undefined ? 'main' : params.sector });
}

exports.initClients = function(){
    var l = arguments.length;
    var client;
    while(l--){
        client = arguments[l];
        require( './transport/' + client + '/client' );
    }
}

exports.debug = function() { this.logger().log('debug', arguments); };
exports.info  = function() { this.logger().log('info',  arguments); };
exports.error = function() { this.logger().log('error', arguments); };
exports.fatal = function() { this.logger().log('fatal', arguments); };

exports.errorInternal = function() { this.logger().log('error', arguments, true); }
