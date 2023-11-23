'use strict';
const util   = require('util');
const Stream = require('stream');
const DripSource = require('../util/DripSource');

module.exports = Message;

function Message(header, data) {
    Stream.call(this);

    this.readable = true;
    this.writable = true;
    this._paused  = false;

    this.header   = header;
    if (data !== undefined) {
        this.slurp(data);
    }
}
util.inherits( Message, Stream );

Message.prototype.write = function( data, encoding ) {
    if (typeof data == 'string')
        return this.write( Buffer.from(data, encoding) );
    if (!Buffer.isBuffer(data))
        throw new Error('passed non-string non-buffer to write');

    this.emit('data',data);
    return !this._paused;
};

Message.prototype.pause = function() {
    this._paused = true;
};
Message.prototype.resume = function() {
    if (this._paused) {
        this._paused = false;
        this.emit('drain');
    }
};

Message.prototype.end = function(data, encoding) {
    if (data !== undefined) {
        this.write(data, encoding);
    }

    if ( this.finished ) return false;
    this.finished = true;

    this.emit('end');
};

Message.prototype.slurp = function(data){
    if (data instanceof Stream) {
        data.pipe(this);
    } else if (data instanceof Buffer) {
        process.nextTick(() => new DripSource(16384, data).pipe(this));
    } else {
        this.slurp(Buffer.from(JSON.stringify(data),'utf8'));
    }
    return this;
};

Message.prototype.readAll = function (callback) {
    let acc = [];
    this.on('data', (d) => acc.push(d));
    this.on('end', () => {
        if (this.error)
            return callback('transport', this.error, null);
        if (this.header.error_code)
            return callback(this.header.error_code, this.header.error, null);

        var resp = Buffer.concat(acc).toString('utf8');
        try {
            resp = JSON.parse(resp);
        } catch (e) {}

        if (resp === undefined)
            return callback('transport', 'failed to parse JSON response', null);

        return callback(null, null, resp);
    });
};

/*

=head1 NAME

handle/RelayMessage.js

=head1 DESCRIPTION

Base type for messages in the JS version of the SCAMP framework.  RelayMessage
objects are read/write node streams which behave as no-op couplers;
additionally, they have headers set at create time and an C<error> property
which is set immediately before end (will be available in 'end' handlers).

*/
