import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
test('incident is actually resolved', () => {
  const file = fs.readFileSync(path.join(process.cwd(), 'incident.txt'), 'utf8');
  assert.match(file, /status=fixed/);
});
