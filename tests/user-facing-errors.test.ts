import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  UserFacingError,
  fetchContests,
  fetchUserDataset,
} from '../src/services/codeforcesApi.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/* Wording that must never reach the user: the API's own comments and parser/HTTP jargon. */
const TECHNICAL = /not found:|User with handle|Call limit|exceeded|\bAPI\b|HTTP|JSON|SyntaxError/;

function replyWith(body: string, status: number) {
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
}

function apiFailure(comment: string, status: number) {
  replyWith(JSON.stringify({ status: 'FAILED', comment }), status);
}

test('profile data: an unknown handle is reported in plain words, not as the API comment', async () => {
  apiFailure('handle: User with handle nobody not found', 400);

  await assert.rejects(fetchUserDataset('nobody'), (error: unknown) => {
    assert.ok(error instanceof UserFacingError);
    assert.equal(error.message, 'This Codeforces user could not be found.');
    assert.doesNotMatch(error.message, TECHNICAL);
    return true;
  });
});

test('contest list: "Call limit exceeded", once the retries are used up, is reported as busy', { timeout: 30_000 }, async () => {
  apiFailure('Call limit exceeded', 503);

  await assert.rejects(fetchContests(), (error: unknown) => {
    assert.ok(error instanceof UserFacingError);
    assert.match(error.message, /busy/);
    assert.doesNotMatch(error.message, TECHNICAL);
    return true;
  });
});

test('contest list: any other API failure gets a general plain message', async () => {
  apiFailure('Something unexpected happened', 400);

  await assert.rejects(fetchContests(), (error: unknown) => {
    assert.ok(error instanceof UserFacingError);
    assert.doesNotMatch(error.message, TECHNICAL);
    assert.doesNotMatch(error.message, /unexpected/);
    return true;
  });
});

test('contest list: a reply that is not JSON is reported in plain words', async () => {
  replyWith('<html>Service unavailable</html>', 503);

  await assert.rejects(fetchContests(), (error: unknown) => {
    assert.ok(error instanceof UserFacingError);
    assert.doesNotMatch(error.message, TECHNICAL);
    return true;
  });
});

test('contest list: a network failure is not a UserFacingError (the profile page words it as a connection problem)', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;

  await assert.rejects(fetchContests(), (error: unknown) => !(error instanceof UserFacingError));
});
