var util = require('util'),
    LogSink = require('../index.js').LogSink();

var config = {
    debug: true,
    tag: 'scamp_unconfigured',
};

var _new_logsink = function() {
    return new LogSink(
        config.logsink_topic ? config.logsink_topic : config.tag,
        'service_log',
        'severity message pid'
    );
};

// Need to create a logsink here as events can occur before configure happens
var logsink = _new_logsink();

exports.log = function (severity, msgbits, internal) {
    if (severity == 'debug' && !config.debug) return; // short circuit

    var message = util.format.apply(util, msgbits),
        date = new Date().toISOString();

    if (internal || severity == 'debug' || severity == 'fatal') {
        console.log(severity, [
            date,
            config.tag,
            process.pid,
            severity,
            message
        ].join('\t'));
    }

    if (severity != 'debug') {
       logsink.log({
           date: date,
           pid: process.pid,
           severity: severity,
           message: message
       });
    }

    if (severity == 'fatal') process.exit(1);
};

exports.configure = function (params) {
    if (config.configured) throw 'Log can only be configured once';

    if ('object' != typeof params) throw 'params must be object';
    if (!params.tag) throw 'params.tag must be specified';

    config.tag = params.tag;
    config.logsink_topic = params.logsink_topic;
    config.configured = true;
    config.debug = params.debug;

    logsink = _new_logsink();
};
