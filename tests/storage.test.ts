import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * storage.ts dispatches a plain DOM `Event` on `window` whenever
 * settings are saved. There is no DOM in this test runner, so a
 * minimal stand-in is set up once, before the module under test is
 * ever imported (its `saveSettings`/`toggleFriendsVisible` reference
 * the global `window` directly).
 */
(globalThis as unknown as { window: EventTarget }).window = new EventTarget();

const {
  toggleFriendsVisible,
  saveSettings,
  loadSettings,
  SETTINGS_CHANGED_EVENT,
} = await import('../src/services/storage.ts');

class FakeStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
});

test('toggleFriendsVisible: flips the flag and leaves every other saved setting untouched', () => {
  saveSettings(
    {
      category: 'Div1',
      hideAC: true,
      tagFilters: ['dp', 'greedy'],
      friendsVisible: false,
    } as never,
    storage,
  );

  const result = toggleFriendsVisible(storage);

  assert.equal(result, true, 'returns the new value');

  const saved = loadSettings(storage);
  assert.equal(saved.friendsVisible, true);
  assert.equal(saved.category, 'Div1', 'unrelated setting must survive');
  assert.equal(saved.hideAC, true, 'unrelated setting must survive');
  assert.deepEqual(saved.tagFilters, ['dp', 'greedy'], 'unrelated setting must survive');
});

test('toggleFriendsVisible: flips back on a second call', () => {
  saveSettings({ friendsVisible: true } as never, storage);
  const result = toggleFriendsVisible(storage);
  assert.equal(result, false);
  assert.equal(loadSettings(storage).friendsVisible, false);
});

test('toggleFriendsVisible: starting from nothing saved at all defaults to on, then flips off', () => {
  // No prior saveSettings call: storage is empty, same as a user who
  // has never touched this setting (normalizeSettings must supply
  // every other field's default, not just leave them undefined).
  const result = toggleFriendsVisible(storage);
  assert.equal(result, false);

  const saved = loadSettings(storage);
  assert.equal(saved.friendsVisible, false);
  assert.equal(saved.category, 'Div4', "normalizeSettings' default, not undefined");
});

test('toggleFriendsVisible: dispatches the same event useFriendsVisible/Controls listen for', () => {
  let firedCount = 0;
  const listener = () => {
    firedCount += 1;
  };

  (globalThis as unknown as { window: EventTarget }).window.addEventListener(
    SETTINGS_CHANGED_EVENT,
    listener,
  );

  try {
    toggleFriendsVisible(storage);
    assert.equal(firedCount, 1);
  } finally {
    (globalThis as unknown as { window: EventTarget }).window.removeEventListener(
      SETTINGS_CHANGED_EVENT,
      listener,
    );
  }
});
