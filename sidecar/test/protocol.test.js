'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequest } = require('../src/protocol');
const { Host } = require('../src/host');
const { EffectRuntime } = require('../src/effects');
const { WorkflowStore } = require('../src/store');
const { fakePlayer } = require('./support');

function testHost() {
  const player = fakePlayer({ devices: [{ id: 'strip' }], zones: [] });
  const host = new Host(player, new WorkflowStore(null), new EffectRuntime());
  return { host, player };
}

test('parseRequest accepts one command object', () => {
  const parsed = parseRequest('{"id":"7","method":"ping","params":{}}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.id, '7');
  assert.equal(parsed.request.method, 'ping');
});

test('parseRequest rejects a broken line', () => {
  const parsed = parseRequest('{');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'bad_json');
});

test('ping and unknown methods', async () => {
  const { host } = testHost();
  const ok = JSON.parse(await host.handleLine('{"id":1,"method":"ping"}'));
  assert.equal(ok.ok, true);
  assert.equal(ok.result.pong, true);
  const bad = JSON.parse(await host.handleLine('{"id":2,"method":"cloud.login"}'));
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'unknown_method');
});

test('setZones plans library colorZones writes', async () => {
  const { host, player } = testHost();
  const line = JSON.stringify({
    id: 'z',
    method: 'setZones',
    params: {
      deviceId: 'strip',
      durationMs: 250,
      zones: [
        { index: 0, hue: 20, saturation: 100, brightness: 40, kelvin: 3500 },
        { index: 1, hue: 20, saturation: 100, brightness: 40, kelvin: 3500 },
        { index: 2, hue: 200, saturation: 80, brightness: 40, kelvin: 3500 }
      ]
    }
  });
  const response = JSON.parse(await host.handleLine(line));
  assert.equal(response.ok, true);
  assert.equal(response.result.writes.length, 2);
  assert.equal(response.result.writes[0].apply, false);
  assert.equal(response.result.writes[0].endIndex, 1);
  assert.equal(response.result.writes[1].apply, true);
  assert.equal(player.calls[0].writes[1].hue, 200);
  assert.equal(player.calls[0].wait, true);
});

test('setZones rejects a zone index past 255', async () => {
  const { host } = testHost();
  const response = JSON.parse(await host.handleLine(JSON.stringify({
    id: 'bad',
    method: 'setZones',
    params: {
      deviceId: 'strip',
      zones: [{ index: 256, hue: 1, saturation: 1, brightness: 1, kelvin: 3500 }]
    }
  })));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'bad_zones');
});
