'use strict';
// scamp-js/lib/actor/service.js

var scamp        = require('../index.js'),
    scamp_util   = scamp.util(),
    fs         = require('fs'),
    crypto     = require('crypto'),
    Message    = require('../handle/Message.js'),
    DripSource = require('../util/DripSource.js'),
    ticket     = require('../util/ticket.js'),
    argp       = require('argparser').vals('pidfile').nonvals('debug').parse();

exports.create = function(params){ return new Service(params) }

function Service(params){
    var me = this;

    if (argp.opt('pidfile'))
        fs.writeFileSync(argp.opt('pidfile'), process.pid);

    if (params.handleSignals !== false) {
        scamp_util.update_service_file(params.tag, true);
    }

    me.actions = params.actions || [];
    me.ident = params.tag + '-' + crypto.randomBytes( 18 ).toString('base64');

    var key = me.key = fs.readFileSync(scamp.config().val(params.tag + '.key', process.env.SCAMP_CONFIG_DIR + '/services/' + params.tag + '.key'));
    var crt = me.cert = fs.readFileSync(scamp.config().val(params.tag + '.cert', process.env.SCAMP_CONFIG_DIR + '/services/' + params.tag + '.crt'));

    me._classes = {};
    me._actions = {};

    me.announcer = scamp.module('discovery/announce').create({
        ident: me.ident,
        key: key,
        cert: crt,
        sector: params.sector || 'main',
        envelopeTypes: params.envelopes || ['json'],
    });
    me.announcer.setClasses( me._classes );

    me._activeRequests = 0;
    me.server  = scamp.server('beepish').create({
        callback: me.handleRequest.bind(me),
        key: key,
        cert: crt,
        listen: function (iface, uri) {
            me.announcer.addAddress(iface, uri);
        }
    });
    me.announcer.on('made_packet', (pkt) => me.server.putSubdata('announce', '', pkt));

    if (params.handleSignals !== false) {
        var stop_and_exit = () => {
            console.log('preparing to stop...');
            me.stopService().then(() => {
                scamp_util.update_service_file(params.tag, false);
                process.exit(1);
            });
        };
        process.on('SIGINT', stop_and_exit);
        process.on('SIGTERM', stop_and_exit);
    }

    scamp.logger().configure({
        tag: params.tag,
        logsink_topic: params.logsink_topic,
        debug: argp.opt('debug')
    });

    me.registerAction(
        `${params.tag}.queue_depth`,
        me.cookedHandler(() => { return { queue_depth: me._activeRequests - 1 } })
    );
};

Service.prototype.stopService = function () {
    if (this._stopping) return this._stopping;
    return this._stopping = new Promise(resolve => {
        this.announcer.suspend();
        setTimeout(() => {
            var done = () => setTimeout(resolve, 1000); // let replies drain, not the right fix
            if (this._activeRequests > 0) {
                this._onNoActiveRequests = done;
            } else {
                done();
            }
        }, 5000);
    });
};

Service.prototype.registerAction = function( /*actionStr, flags, version, handler*/ ){
    var args = Array.prototype.slice.call(arguments);
    var handler = args.pop();
    if (!handler) throw "action handler required";
    var actionStr = args.shift();
    if (!actionStr) throw "action name required";
    var flags = args.shift() || '';
    var version = args.shift() || 1;

    var me    = this;

    var parts = actionStr.split(/\./);

    if(parts.length < 2) return null;

    var actionPart = parts.pop();
    var classStr   = parts.join('.');

    var cls    = me._classes[classStr] = me._classes[classStr] || {};
    cls[actionPart + '.v' + version] = [actionPart, flags, version];

    if (me.announcer) me.announcer.setClasses( me._classes );

    me._actions[actionStr.toLowerCase() + '.v' + version] = handler;
};

Service.prototype.fullHandler = function( orig_handler ) {
    return function (req, onrpy) {
        var m = new Message({});

        var in_parts = [];
        req.on('data', function (d) { in_parts.push(d); });
        req.on('end', function () {
            var ret = orig_handler( req.header, req.error ? new Error(req.error) : Buffer.concat(in_parts) );

            if (ret instanceof Error) {
                m.header.error = ret.message;
                m.header.error_code = ret.code;
                onrpy(m);
                m.end();
            } else {
                onrpy(m);
                new DripSource(1024, ret).pipe(m);
            }
        });
    };
};

Service.prototype.cookedHandler = function( orig_handler ) {
    return this.fullHandler(function (hdr, input) {
        if (input instanceof Error) return new Error('Failed to receive request: ' + input.message);
        if (hdr.envelope != 'json') return new Error('Unsupported envelope type: ' + hdr.envelope);

        var obj;
        try {
            obj = JSON.parse( input.toString('utf8') );
            obj = orig_handler( hdr, obj );
            return Buffer.from(JSON.stringify( obj ), 'utf8');
        } catch (e) {
            var err = new Error(String(e.message));
            err.code = 'generic';
            return err;
        }
    });
};

// TODO: impliment handler for actions that expect streaming input

// TODO: expand to support other envelope types
Service.prototype.staticJsonHandler = function( orig_handler, check_access_override ) {
    return function (req, onrpy, check_access) {
        if (req.header.envelope != 'json') return new Error('Unsupported envelope type: ' + req.header.envelope);

        var return_handler = function(return_value) {
            var m = new Message({});

            var drip_handler = function(value, drip_source) {
                onrpy(m);
                drip_source = drip_source || new DripSource(1024, value);
                drip_source.pipe(m);
            };

            if (!return_value) {
                onrpy(new Error('return_value required'));
            }
            else if (return_value.pipe instanceof Function) {
                drip_handler(null, return_value);
            }
            else {
                if (return_value instanceof Error) {
                    onrpy(return_value);
                }
                else if (return_value instanceof Object) {
                    drip_handler(Buffer.from(JSON.stringify(return_value)));
                }
                else {
                    try {
                        drip_handler(Buffer.from(return_value, 'utf8'));
                    }
                    catch (e) {
                        onrpy(e);
                    }
                }
            }
        };

        var data_parts = [];

        req.on('data', function (d) { data_parts.push(d) });

        req.on('end', function () {
            var end_handler = function(err, this_ticket) {
                if (err) return return_handler(err);

                var data = Buffer.concat(data_parts);

                try {
                    data = JSON.parse(data.toString('utf8'));
                }
                catch (e) {
                    return return_handler(e);
                }

                data.client_id = data.client_id || req.header.client_id;
                var ret = orig_handler(this_ticket, data, return_handler);

                if (typeof ret != 'undefined') return_handler(ret);
            };

            if (check_access_override instanceof Function) {
                check_access_override(req, end_handler);
            }
            else {
                check_access(end_handler);
            }
        });
    };
};

Service.prototype.handleRequest = function (req, onrpy) {
    var me = this;

    var orig_onrpy = onrpy;

    me._activeRequests++;
    onrpy = function (m) {
        // convenience
        if (m instanceof Error) {
            var msg = new Message({});
            msg.error = String(m);
            orig_onrpy(msg);
            msg.end('');
        } else {
            orig_onrpy(m);
        }
        me._activeRequests--;
        if (me._activeRequests === 0 && me._onNoActiveRequests) {
            var on_none = me._onNoActiveRequests;
            me._onNoActiveRequests = null;
            on_none();
        }
    };

    var handler = me._actions[ String(req.header.action).toLowerCase() + '.v' + req.header.version ];
    if(!handler) return onrpy(new Error("action not found"));

    // TODO: refactor - the handler itself shouldn't be the one calling this function to check access, but
    //       good enough for now - only actions that need access checking are using staticJsonHandler.
    handler(req, onrpy, function (callback) {
        var this_ticket = ticket.verify(req.header.ticket);

        ticket.checkAccess({
            action: {
                name: req.header.action.toLowerCase(),
                envelope: req.header.envelope,
                version: req.header.version
            },
            ticket: this_ticket
        }, function(err) {
            callback(err, this_ticket);
        });
    });
};
