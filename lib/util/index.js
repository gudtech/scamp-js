var fs = require('fs');
const RUNNING_SERVICES_DIR = '/backplane/running-services/';

exports.string = function(){
  return require("./string.js");
}

exports.update_service_file = function(tag, running) {
    var file = RUNNING_SERVICES_DIR + tag;

    running ? fs.writeFileSync(file, '') : fs.unlinkSync(file);

    return;
}
