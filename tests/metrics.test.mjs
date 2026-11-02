import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../assets/runtime/metrics-server.js', import.meta.url), 'utf8');
const FIRST_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ID = '00000000-0000-4000-8000-000000000002';

/** Encode nonnegative protobuf scalars for synthetic, non-private telemetry fixtures. */
function varint(number) {
  let remaining = BigInt(number);
  const bytes = [];
  do {
    let byte = Number(remaining & 127n);
    remaining >>= 7n;
    if (remaining) byte |= 128;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

/** Encode either a scalar or a nested length-delimited message. */
function field(number, value) {
  return Buffer.isBuffer(value)
    ? Buffer.concat([varint(number * 8 + 2), varint(value.length), value])
    : Buffer.concat([varint(number * 8), varint(value)]);
}

/** Build only the documented fields used by the metrics reader, without prompts. */
function generation({ limit, input = 12000, cache = 4000, output = 120, model = 1418 } = {}) {
  const usage = Buffer.concat([field(2, input), field(3, output), field(5, cache)]);
  const budget = limit === undefined ? Buffer.alloc(0) : field(4, limit);
  const modelField = model === null ? Buffer.alloc(0) : field(3, model);
  return field(1, Buffer.concat([
    modelField, field(4, usage), field(9, field(10, Buffer.concat([field(1, input + cache + 200), budget]))),
    field(11, field(1, 2)), field(12, field(1, 3))
  ]));
}

/** Create an isolated home and expose the module's functions without touching real user databases. */
function fixture(testContext, sendCDP = async () => ({})) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-metrics-test-'));
  const directory = path.join(home, '.gemini/antigravity/conversations');
  fs.mkdirSync(directory, { recursive: true });
  testContext.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const globals = { fs, path, os: { homedir: () => home }, DatabaseSync, sendCDP, activeSockets: new Map() };
  const api = new vm.Script(source + '\n;({parseProto,getDbSignature,readConversationMetrics,pushMetricsToSession})').runInNewContext(globals);
  function createDatabase(identifier, rows) {
    const filename = path.join(directory, identifier + '.db');
    const database = new DatabaseSync(filename);
    database.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER);');
    for (const [index, data] of rows.entries()) {
      database.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(index, data);
      database.prepare('INSERT INTO steps VALUES (?, ?)').run(index * 2, 14);
      database.prepare('INSERT INTO steps VALUES (?, ?)').run(index * 2 + 1, 15);
    }
    database.close();
    return filename;
  }
  return { ...api, directory, createDatabase };
}

test('uses the recorded 256k budget and includes cached input in the numerator', testContext => {
  const api = fixture(testContext);
  const filename = api.createDatabase(FIRST_ID, [generation({ limit: 256000 })]);
  const before = fs.readFileSync(filename);
  const result = api.readConversationMetrics(FIRST_ID);
  assert.equal(result.maxContextTokens, 256000);
  assert.equal(result.contextTokens, 16000);
  assert.equal(result.estimatedContextTokens, 16200);
  assert.equal(result.modelId, 1418);
  assert.equal(result.generationIndex, 0);
  assert.match(result.inlineHtml, /Ctx 16k\/256k \(6%\)/);
  assert.equal(result.contextLimitSource, 'ChatStartMetadata.context_window_metadata.max_context_tokens');
  assert.deepEqual(fs.readFileSync(filename), before, 'read-only metrics must leave database bytes unchanged');
});

test('uses the latest call budget rather than a constant or a previous call', testContext => {
  const api = fixture(testContext);
  api.createDatabase(FIRST_ID, [generation({ limit: 256000, model: 1417 }), generation({ limit: 983040, model: 1419 })]);
  const result = api.readConversationMetrics(FIRST_ID);
  assert.equal(result.maxContextTokens, 983040);
  assert.equal(result.modelId, 1419);
  assert.equal(result.generationIndex, 1);
  assert.match(result.inlineHtml, /Ctx 16k\/983k \(2%\)/);
  assert.doesNotMatch(result.tooltipHtml, /距压缩余|压缩水位线/);
});

test('missing or zero budget produces usage only, never a guessed denominator', testContext => {
  const api = fixture(testContext);
  for (const [identifier, limit] of [[FIRST_ID, undefined], [SECOND_ID, 0]]) {
    api.createDatabase(identifier, [generation({ limit, model: null })]);
    const result = api.readConversationMetrics(identifier);
    assert.equal(result.maxContextTokens, null);
    assert.equal(result.modelId, null);
    assert.equal(result.contextLimitSource, null);
    assert.match(result.inlineHtml, /<span>Ctx 16k<\/span>/);
    assert.doesNotMatch(result.inlineHtml, /256k|983k|\(%|\(\d+%\)/);
    assert.match(result.tooltipHtml, /最近调用上下文预算.*未获取/);
  }
});

test('latest generation without usage is not measured zero or previous-call usage', testContext => {
  const api = fixture(testContext);
  const pendingGeneration = field(1, Buffer.concat([field(3,1418),field(9,field(10,field(4,983040)))]));
  api.createDatabase(FIRST_ID,[generation({limit:256000}),pendingGeneration]);
  const result = api.readConversationMetrics(FIRST_ID);
  assert.equal(result.hasData,false);
  assert.equal(result.contextTokens,undefined);
  assert.equal(result.inlineHtml,undefined);
});

test('retains upstream visual tiers using the recorded budget, never a fixed 256k threshold', testContext => {
  const api = fixture(testContext);
  api.createDatabase(FIRST_ID,[generation({limit:983040,input:737280,cache:0})]);
  api.createDatabase(SECOND_ID,[generation({limit:100000,input:90000,cache:0})]);
  assert.match(api.readConversationMetrics(FIRST_ID).inlineHtml,/class="ag-ctx-warn"/);
  assert.match(api.readConversationMetrics(SECOND_ID).inlineHtml,/class="ag-ctx-crit"/);
});

test('switching conversations keeps each budget isolated', testContext => {
  const api = fixture(testContext);
  api.createDatabase(FIRST_ID, [generation({ limit: 256000 })]);
  api.createDatabase(SECOND_ID, [generation({ limit: 983040 })]);
  assert.equal(api.readConversationMetrics(FIRST_ID).maxContextTokens, 256000);
  assert.equal(api.readConversationMetrics(SECOND_ID).maxContextTokens, 983040);
  assert.equal(api.readConversationMetrics(FIRST_ID).maxContextTokens, 256000);
});

test('database changes invalidate the cached result', testContext => {
  const api = fixture(testContext);
  const filename = api.createDatabase(FIRST_ID, [generation({ limit: 256000 })]);
  assert.equal(api.readConversationMetrics(FIRST_ID).maxContextTokens, 256000);
  const database = new DatabaseSync(filename);
  database.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(1, generation({ limit: 983040 }));
  database.prepare('INSERT INTO steps VALUES (?, ?)').run(3, 15);
  database.close();
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(filename, future, future);
  assert.equal(api.readConversationMetrics(FIRST_ID).maxContextTokens, 983040);
});

test('missing databases and invalid identifiers are never created or opened', testContext => {
  const api = fixture(testContext);
  const result = api.readConversationMetrics(FIRST_ID);
  assert.equal(result.hasData, false);
  assert.equal(fs.existsSync(path.join(api.directory, FIRST_ID + '.db')), false);
  for (const identifier of ['../outside', '-'.repeat(36), '', null]) {
    assert.equal(api.readConversationMetrics(identifier), null);
    assert.equal(api.getDbSignature(identifier), null);
  }
  assert.deepEqual(fs.readdirSync(api.directory), []);
});

test('empty, corrupt, and malformed telemetry fail safely', testContext => {
  const api = fixture(testContext);
  api.createDatabase(FIRST_ID, []);
  assert.equal(api.readConversationMetrics(FIRST_ID).hasData, false);
  fs.writeFileSync(path.join(api.directory, SECOND_ID + '.db'), 'not a sqlite database');
  assert.equal(api.readConversationMetrics(SECOND_ID), null);
  const malformedId = '00000000-0000-4000-8000-000000000003';
  api.createDatabase(malformedId, [Buffer.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f])]);
  assert.equal(api.readConversationMetrics(malformedId), null);
});

test('protobuf reader rejects truncated, overflowing and invalid wire encodings', testContext => {
  const api = fixture(testContext);
  const invalid = [
    Buffer.from([0x80]), Buffer.from([0]), Buffer.from([0x0b]),
    Buffer.from([0x09, 1]), Buffer.from([0x0d, 1]),
    Buffer.from([0x0a, 4, 1]), Buffer.concat([field(1, 1), Buffer.from([0x80])]),
    Buffer.concat([Buffer.from([8]), varint(BigInt(Number.MAX_SAFE_INTEGER) + 1n)]),
    Buffer.from([8, ...Array(11).fill(0xff)])
  ];
  for (const bytes of invalid) assert.throws(() => api.parseProto(bytes));
  assert.throws(() => api.parseProto(123));
  assert.equal(api.parseProto(field(1, 983040)).get(1), 983040);
});

test('bytes in numeric usage fields cannot be rendered as HTML', testContext => {
  const api = fixture(testContext);
  const maliciousUsage = field(1, field(4, field(2, Buffer.from('<img src=x>'))));
  api.createDatabase(FIRST_ID, [maliciousUsage]);
  assert.equal(api.readConversationMetrics(FIRST_ID), null);
});

test('failed CDP delivery retries unchanged data instead of marking it as delivered', async testContext => {
  let attempts = 0;
  const api = fixture(testContext, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('simulated connection failure');
    return {};
  });
  api.createDatabase(FIRST_ID, [generation({ limit: 983040 })]);
  const session = { ws: { readyState: 1 } };
  await api.pushMetricsToSession(session, FIRST_ID);
  assert.equal(session.lastPushedSig, undefined);
  await api.pushMetricsToSession(session, FIRST_ID);
  assert.equal(attempts, 2);
  assert.match(session.lastPushedSig, new RegExp('^' + FIRST_ID + '@'));
  await api.pushMetricsToSession(session, FIRST_ID);
  assert.equal(attempts, 2, 'successful unchanged payloads remain deduplicated');
});
