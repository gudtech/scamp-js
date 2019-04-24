'use strict';

const scamp = require('../index.js');

function LogSink(params) {
    if (arguments.length > 1) {
        params = {
            topic: arguments[0],
            subtopic: arguments[1],
            fields: arguments[2]
        };
    }

    if (!params.topic) throw 'topic required';
    if (!params.subtopic) throw 'subtopic required';
    if (!params.fields) throw 'fields (array or space-delimited string) required';

    this.fields = Array.isArray(params.fields) ? params.fields : params.fields.split(' ');
    if (this.fields.length <= 0) throw 'at least one field required';

    this.hostname = require('os').hostname();
    this.destination = new (require('./destination/console.js'))(params);
}

LogSink.prototype.log = function (log_data) {
    let me = this;

    process.nextTick(() => {
        me.fields.forEach(function(field) {
            if (!log_data.hasOwnProperty(field)) scamp.error(`values missing ${field}`);

            let field_value = log_data[field];
            if (typeof field_value != 'number' && field_value != null) {
                log_data[field] = scamp.util().string().safeStr(field_value);
            }
        });

        log_data.service_hostname = me.hostname;

        me.destination.write_log(log_data);
    });
};

module.exports = LogSink;
