var should = require('chai').should();

var str = require('../../lib/util/string');

describe('scamp.util.string', function() {
  describe('#safeStr()', function() {
    let grenade = {
        toString: function () { throw "kaboom" }
    };
    it('should return a default value when toString blows up', function() {
      str.safeStr(grenade).should.equal('[object Object]');
    });
    it('should stringify ordinary values straightforwardly', function() {
      str.safeStr(42).should.equal('42');
    });
  });
});

