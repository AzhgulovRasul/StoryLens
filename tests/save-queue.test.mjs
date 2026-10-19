import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/save-queue.js';

test('edits during a pending write are serialized and preserved', async () => {
  let value = { text: 'первый' }, release;
  const writes = [];
  const queue = new SaveQueue(() => value, async snapshot => {
    writes.push(snapshot);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  });
  queue.mark();
  const pending = queue.flush();
  value.text = 'последний'; queue.mark();
  const second = queue.flush();
  release(); await Promise.all([pending, second]);
  assert.deepEqual(writes, [{ text: 'первый' }, { text: 'последний' }]);
  assert.equal(queue.dirty, false);
});

test('write failure remains dirty and can be retried', async () => {
  let fail = true;
  const queue = new SaveQueue(() => ({ text: 'не потерять' }), async () => { if (fail) throw Error('disk full'); });
  queue.mark(); await assert.rejects(queue.flush()); assert.equal(queue.dirty, true);
  fail = false; await queue.flush(); assert.equal(queue.dirty, false);
});
