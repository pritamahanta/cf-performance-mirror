import test from 'node:test';
import assert from 'node:assert/strict';

import { highlight, looksLikePython } from '../src/domain/highlight.ts';

/*
 * "type:text" for every token, whitespace-only tokens left out. The
 * expectations below are the colors read off a screenshot of the
 * Codeforces source view for the same code.
 */
function classes(source: string): string[] {
  return highlight(source)
    .filter(token => token.text.trim() !== '')
    .map(token => `${token.type}:${token.text.trim()}`);
}

test('comments', () => {
  assert.deepEqual(classes('// In the name of Allah.'), ['com:// In the name of Allah.']);
  assert.deepEqual(classes('/* a\nb */ int'), ['com:/* a\nb */', 'typ:int']);
});

test('#include is a comment-colored word and the header after it is ordinary tokens', () => {
  assert.deepEqual(classes('#include <bits/stdc++.h>'), [
    'com:#include',
    'pun:<',
    'pln:bits',
    'pun:/',
    'pln:stdc',
    'pun:++.',
    'pln:h',
    'pun:>',
  ]);
});

test('keywords, types and numbers', () => {
  assert.deepEqual(classes('using namespace std;'), ['kwd:using', 'kwd:namespace', 'pln:std', 'pun:;']);
  assert.deepEqual(classes('const int T = 50;'), ['kwd:const', 'typ:int', 'pln:T', 'pun:=', 'lit:50', 'pun:;']);
  assert.deepEqual(classes('void solve() {'), ['kwd:void', 'pln:solve', 'pun:()', 'pun:{']);
  assert.deepEqual(classes('for (int &x : a){'), [
    'kwd:for',
    'pun:(',
    'typ:int',
    'pun:&',
    'pln:x',
    'pun::',
    'pln:a',
    'pun:){',
  ]);
  assert.deepEqual(classes('while (t--)'), ['kwd:while', 'pun:(', 'pln:t', 'pun:--)']);
});

test('strings and char literals, quotes included', () => {
  assert.deepEqual(classes("next += (c - '0') * (c - '0');"), [
    'pln:next',
    'pun:+=',
    'pun:(',
    'pln:c',
    'pun:-',
    "str:'0'",
    'pun:)',
    'pun:*',
    'pun:(',
    'pln:c',
    'pun:-',
    "str:'0'",
    'pun:);',
  ]);
  assert.deepEqual(classes("cout << ans << '\\n';"), ['pln:cout', 'pun:<<', 'pln:ans', 'pun:<<', "str:'\\n'", 'pun:;']);
});

test('names with :: and . stay plain, false and nullptr are keywords', () => {
  assert.deepEqual(classes('ios::sync_with_stdio(false);'), [
    'pln:ios',
    'pun:::',
    'pln:sync_with_stdio',
    'pun:(',
    'kwd:false',
    'pun:);',
  ]);
  assert.deepEqual(classes('cin.tie(nullptr);'), ['pln:cin', 'pun:.', 'pln:tie', 'pun:(', 'kwd:nullptr', 'pun:);']);
});

test('number forms: suffixes, exponents, hex, and digits inside names', () => {
  assert.deepEqual(classes('x = 100LL + 1e9 + 0x3f3f3f3f + a1;'), [
    'pln:x',
    'pun:=',
    'lit:100LL',
    'pun:+',
    'lit:1e9',
    'pun:+',
    'lit:0x3f3f3f3f',
    'pun:+',
    'pln:a1',
    'pun:;',
  ]);
});

test('an unclosed string stops at the end of its line', () => {
  assert.deepEqual(classes('s = "abc\nint'), ['pln:s', 'pun:=', 'str:"abc', 'typ:int']);
});

test('every character of the source is kept, in order', () => {
  const source = '#include <x>\nint main() {\n\treturn 0; // done\n}\n';
  assert.equal(highlight(source).map(token => token.text).join(''), source);
});

test('python: # comments, // is not a comment, triple-quoted strings', () => {
  const source = 'import sys\n# read\ndef f(x):\n    return x // 2\n"""doc\nmore"""\n';

  assert.equal(looksLikePython(source), true);

  assert.deepEqual(classes(source), [
    'kwd:import',
    'pln:sys',
    'com:# read',
    'kwd:def',
    'pln:f',
    'pun:(',
    'pln:x',
    'pun:):',
    'kwd:return',
    'pln:x',
    'pun://',
    'lit:2',
    'str:"""doc\nmore"""',
  ]);

  assert.equal(highlight(source).map(token => token.text).join(''), source);
});

test('C++ is not mistaken for python', () => {
  assert.equal(looksLikePython('#include <x>\nint main() {\n  return 0;\n}\n'), false);
  assert.equal(looksLikePython('class A {\npublic:\n  int x;\n};\n'), false);
});
