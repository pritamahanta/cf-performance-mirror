import test from 'node:test';
import assert from 'node:assert/strict';

import { friendSubmissionsGate } from '../src/domain/friendSubmissionsGate';

test('gate: feature on and box open - scan and show', () => {
  assert.deepEqual(friendSubmissionsGate({ enabled: true, expanded: true }), {
    fetching: true,
    showBody: true,
  });
});

test('gate: feature on and box collapsed - the scan still runs, nothing is shown', () => {
  assert.deepEqual(friendSubmissionsGate({ enabled: true, expanded: false }), {
    fetching: true,
    showBody: false,
  });
});

test('gate: feature off - no scan and nothing shown, whatever the chevron says', () => {
  for (const expanded of [true, false]) {
    assert.deepEqual(friendSubmissionsGate({ enabled: false, expanded }), {
      fetching: false,
      showBody: false,
    });
  }
});
