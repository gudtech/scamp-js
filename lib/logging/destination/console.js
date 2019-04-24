'use strict';

let util = require('util');

function DevLog(params) {
    if (!params.topic) throw 'topic required';
    if (!params.subtopic) throw 'subtopic required';

    this.topic = params.topic;
    this.subtopic = params.subtopic;
}

DevLog.prototype.write_log = function(log_data) {
    console.log(this.topic, this.subtopic, util.inspect(log_data, { showHidden: false, depth: 5 }));

    return;
}

module.exports = DevLog;
