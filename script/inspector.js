'use strict';

var scamp = require('../lib/index.js'),
    util = require('util'),
    svc = scamp.service({ tag: 'scamp-inspector' }),
    Message = scamp.module('handle/Message');

let handlers = {
    'ScampInspector.Service.status': (ticket, data, return_handler) => {
        if (!data || !data.service_name || !data.ip_address) {
            return_handler({ error_code: 'bad_request', error: 'Invalid parameters' });
            return;
        }

        let services = scamp.engine().listServices();

        let action_count;
        let services_found = services.filter(service => {
            let address_parts = service.address.split(':'),
                port = address_parts.pop(),
                ip_address = address_parts.pop().replace('//', '');

            if (!service.ref.ident.match(`^${data.service_name}[-:]`)) return false;
            if (data.ip_address != ip_address) return false;
            if (data.sector && data.sector != service.ref.sector) return false;
            if (service.actions.length <= 0) return false;
            if (data.fingerprint && data.fingerprint != service.fingerprint) return false;
            if (data.port && data.port != port) return false;

            let authorized_actions = service.actions.filter(
                action => action.namespace != '_meta'
                    && service.authorized(action.sector, [action.namespace, action.name].join('.'))
            );

            if (authorized_actions.length <= 0) return false;

            action_count = authorized_actions.length;

            return true;
        });

        return_handler(
            services_found.length > 1 ? { error_code: 'bad_request', error: 'Multiple services found' }
                : services_found.length > 0 ? { service_found: true, action_count: action_count }
                : { error_code: 'not_found', error: 'Service not found' }
        );

        return;
    },

    'ScampInspector.Service.query_queue_depth': (ticket, data, return_handler) => {
        if (!data || !data.service_name) {
            return { error_code: 'bad_request', error: 'Invalid parameters' };
        }

        let services = scamp.engine().listServices().filter(
            service => service.ref.ident.match(`^${data.service_name}[-:]`));

        if (data.sample_fraction || data.sample_count) {
            let count = data.sample_fraction
                ? Math.ceil(services.length * data.sample_fraction) : data.sample_count;
            services = services.sort(() => Math.random() > 0.5 ? 1 : -1).slice(0, count);
        }

        let queue_depth_actions = [];
        services.forEach(service => {
            let found_action = service.actions
                .filter(
                    action => action.namespace == data.service_name && action.name == 'queue_depth')
                .sort((a, b) => a.version - b.version)
                .pop();

            if (found_action) {
                found_action.service = service;
                queue_depth_actions.push(found_action);
            }
        });

        if (queue_depth_actions.length == 0) {
            return_handler({ avg_queue_depth: null, total_queue_depth: null });
            return;
        }

        let requester = scamp.requester({}),
            waiting = queue_depth_actions.length,
            results = [],
            sum = 0;
        queue_depth_actions.forEach(action => {
            requester.forwardRequest({
                ident: action.service.workerIdent,
            }, new Message({
                action: `${action.namespace}.${action.name}`,
                envelope: action.envelopes[0],
                version: action.version,
                ticket: ticket,
            }, {}), (queue_err, queue_rpy) => {
                if (queue_err) {
                    return_handler(queue_err);
                    return;
                }

                queue_rpy.readAll((err_code, err, response) => {
                    if (err) {
                        return_handler(err);
                        return;
                    }

                    results.push({
                        ident: action.service.ref.ident,
                        address: action.service.address,
                        fingerprint: action.service.fingerprint,
                        queue_depth: response.queue_depth
                    });

                    sum += response.queue_depth;
                    waiting--;

                    if (waiting <= 0) {
                        return_handler({
                            avg_queue_depth: sum / services.length,
                            total_queue_depth: sum,
                            services: results
                        });
                        return;
                    }
                });
            });
        });

        return;
    },

    'ScampInspector.Action.health_check': (ticket, data, return_handler) => {
        if (!data) {
            return_handler({ error_code: 'bad_request', error: 'Invalid parameters' });
            return;
        }

        let services = scamp.engine().listServices();

        let action_copies_map = {};
        services.forEach(service => {
            service.actions.forEach(action => {
                let action_full_name
                    = `${action.sector}:${action.namespace}.${action.name}.v${action.version}`;

                if (!service.ref.ident.match(`^${data.service_name}[-:]`)) return;
                if (data.sector && action.sector != data.sector) return;
                if (data.namespace && action.namespace != data.namespace) return;
                if (data.name && action.name != data.name) return;
                if (data.version && action.version != data.version) return;
                if (data.regex && action_full_name.match(new RegExp(data.regex, 'i'))) return;
                if (!data.all && !service.authorized(
                    action.sector, [action.namespace, action.name].join('.'))) return;

                action_copies_map[action_full_name] = action_copies_map[action_full_name] || 0;
                action_copies_map[action_full_name]++
            });
        });

        Object.keys(action_copies_map).forEach(key => {
            if (action_copies_map[key] < (typeof data.copies != 'undefined' ? data.copies : 1)) {
                delete action_copies_map[key];
            }
        });

        return_handler(action_copies_map);

        return;
    }
};

Object.keys(handlers).forEach(key => {
    svc.registerAction(key, svc.staticJsonHandler(handlers[key]));
});
