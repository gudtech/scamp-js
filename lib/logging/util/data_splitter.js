'use strict';

var crypto = require('crypto');

class DataSplitter {
    constructor (max_part_size, parts_limit, id_field, continuation_char, see_previous_char) {
        if (!max_part_size) throw 'max_part_size required';
        if (!parts_limit) throw 'parts_limit required';
        if (typeof id_field == 'undefined') throw 'id_field required';

        this.max_part_size = max_part_size;
        this.parts_limit = parts_limit;
        this.id_field = id_field;
        this.continuation_char = continuation_char || '…';
        this.see_previous_char = see_previous_char || null;
    }

    split_by_length(data_object, id_base) {
        let me = this,
            parts = [];
        id_base = id_base || crypto.randomBytes(8).toString('hex');

        let state = {
            completed_fields: {},
            remaining_parts: true,
            remainder: Object.assign({}, data_object),
        };

        while (true) {
            _set_part_id(me, state.remainder, id_base, parts.length, me.parts_limit);

            parts.push(_get_part_and_update_state(me, state));

            if (parts.length >= me.parts_limit || !state.remaining_parts) {
                break;
            }
        }

        // Update part ids now that we know the final number of parts
        _update_part_ids(me, id_base, parts);

        return parts;
    }
}

function _get_part_and_update_state(me, state) {
    state.remaining_parts = false;

    // Using Object.assign() retains key ordering
    let part = Object.assign({}, state.remainder);
    Object.keys(part).forEach(
        field => part[field] = field == me.id_field ? part[field] : '');
    let continuation_fill_length
        = (Object.keys(part).length - 1) * Buffer.byteLength(me.continuation_char);
    let max_part_size = me.max_part_size - continuation_fill_length;
    let empty_part_length = Buffer.byteLength(JSON.stringify(part)) + continuation_fill_length;
    let done_splitting = false;

    Object.keys(state.remainder)
        .sort((a, b) => {
            // Sort fields by value size, ascending
            return Buffer.byteLength(`${state.remainder[a]}`) - Buffer.byteLength(`${state.remainder[b]}`);
        })
        .forEach(field => {
            if (field == me.id_field) {
                // Can't split the id or we won't be able to find subsequent parts once logged
                part[field] = state.remainder[field];
                return;
            }

            if (done_splitting) {
                part[field] = me.continuation_char;
                return;
            }

            if (state.completed_fields[field]) {
                part[field] = state.remainder[field] = me.see_previous_char;
                return;
            }

            let part_length = Buffer.byteLength(JSON.stringify(part));

            if (part_length >= max_part_size) {
                part[field] = state.remainder[field] = me.continuation_char;
                return;
            }

            if (typeof state.remainder[field] == 'number') {
                let field_length = Buffer.byteLength(`${state.remainder[field]}`);

                // We're trying not to split number fields, but if the value is longer than
                // the max part size, we have no hope of representing it without splitting,
                // so, we'll convert to string and let the later logic do the splitting.
                if (field_length > max_part_size - empty_part_length) {
                    state.remainder[field] = `${state.remainder[field]}`;
                }
                else if (field_length < max_part_size - part_length) {
                    part[field] = state.remainder[field];
                    state.remainder[field] = null;
                    state.completed_fields[field] = true;
                    return;
                }
                else {
                    part[field] = me.continuation_char;
                    state.remaining_parts = true;
                    return;
                }
            }

            // Intentionally not using else if as number field could have been converted to
            // string above
            if (
                typeof state.remainder[field] == 'string'
                    || Buffer.isBuffer(state.remainder[field])
            ) {
                let field_buffer = Buffer.from(state.remainder[field]);
                let stringified_field = JSON.stringify(field_buffer.toString());
                let slice_end = Math.min(
                    Buffer.byteLength(stringified_field),
                    max_part_size - part_length
                );

                if (slice_end < Buffer.byteLength(stringified_field)) {
                    let initial_slice = field_buffer.slice(0, slice_end);

                    // Attempt to take into account possible expansion of the string due
                    // to special character escaping upon stringification.  Subtract two for
                    // the quote characters that get added, but aren't used in the final stringified
                    // data object.  This isn't perfect but should prevent strings from expanding
                    // beyond available space.
                    slice_end -= Buffer.byteLength(JSON.stringify(initial_slice.toString()))
                        - Buffer.byteLength(initial_slice.toString()) - 2;

                    // Note that this could slice in the middle of a multi-byte character
                    part[field] = field_buffer.slice(0, slice_end).toString() + me.continuation_char;
                    state.remainder[field]
                        = me.continuation_char + field_buffer.slice(slice_end).toString();
                    state.remaining_parts = true;
                    done_splitting = true;
                }
                else {
                    part[field] = state.remainder[field];
                    state.remainder[field] = null;
                    state.completed_fields[field] = true;
                }
            }
            else {
                part[field] = `[${typeof state.remainder[field]} Object]`;
                state.remainder[field] = null;
                state.completed_fields[field] = true;
            }
        });

    return part;
}

function _update_part_ids(me, id_base, parts) {
    parts.forEach((part, index, arr) => {
        _set_part_id(me, part, id_base, index, arr.length);
    });
}

function _make_part_id(id_base, index, total_parts) {
    return `${id_base}-${index}/${total_parts}`;
}

function _set_part_id(me, data, id_base, index, total_parts) {
    if (me.id_field) data[me.id_field] = _make_part_id(id_base, index + 1, total_parts);
}

module.exports = DataSplitter;
