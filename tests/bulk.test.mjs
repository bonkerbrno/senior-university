import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, categoryPath, parseTable } from '../docs/js/bulk.js';

test('cleanUrl vytáhne odkaz z markdownu, závorek a koncové interpunkce', () => {
  assert.equal(cleanUrl('[https://www.youtube.com/watch?v=abc](https://www.youtube.com/watch?v=abc)'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(cleanUrl('<https://www.youtube.com/watch?v=abc>'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(cleanUrl('(https://www.youtube.com/watch?v=abc).'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(cleanUrl('https://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(cleanUrl('nejde'), 'nejde');
});
test('categoryPath a parseTable zůstávají v pořádku', () => {
  assert.deepEqual(categoryPath('A / B'), ['A', 'B']);
  assert.deepEqual(parseTable('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]);
});
