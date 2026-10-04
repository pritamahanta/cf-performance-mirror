import test from 'node:test';
import assert from 'node:assert/strict';

import { withDeadline, DeadlineError } from '../src/services/deadline.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const never = () => new Promise<never>(() => {});

test('deadline: passes a result through', async () => {
  assert.equal(await withDeadline(Promise.resolve(7), 1000), 7);
});

test('deadline: passes the original error through', async () => {
  const boom = new Error('boom');
  await assert.rejects(withDeadline(Promise.reject(boom), 1000), error => error === boom);
});

test('deadline: a promise that never settles is cut off', async () => {
  const startedAt = Date.now();
  await assert.rejects(withDeadline(never(), 40, undefined, 'Thing'), (error: Error) => {
    assert.ok(error instanceof DeadlineError);
    assert.match(error.message, /Thing timed out/);
    return true;
  });
  assert.ok(Date.now() - startedAt < 400);
});

test('deadline: abort cuts it off even when the work ignores the signal', async () => {
  const controller = new AbortController();
  const pending = withDeadline(never(), 10_000, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, DeadlineError);
});

test('deadline: an already aborted signal rejects at once', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withDeadline(never(), 10_000, controller.signal), DeadlineError);
});

test('deadline: a late result or late failure after the cut-off is harmless', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    await assert.rejects(
      withDeadline(new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 60)), 10),
      DeadlineError,
    );
    await assert.rejects(
      withDeadline(new Promise((resolve) => setTimeout(() => resolve('late'), 60)), 10),
      DeadlineError,
    );

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      withDeadline(new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 30)), 10_000, controller.signal),
      DeadlineError,
    );

    await sleep(120);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('deadline: a result that arrives in time wins, and the timer is released', async () => {
  const controller = new AbortController();
  const value = await withDeadline(sleep(10).then(() => 'ok'), 500, controller.signal);
  assert.equal(value, 'ok');
  /* The abort listener is gone, so a later abort changes nothing. */
  controller.abort();
});

test('deadline: 0 means no time limit', async () => {
  assert.equal(await withDeadline(sleep(60).then(() => 'slow'), 0), 'slow');
});
