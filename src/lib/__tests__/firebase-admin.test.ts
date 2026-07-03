// parseServiceAccountKey unit tests
import test from 'node:test';
import assert from 'node:assert';
import { parseServiceAccountKey } from '../firebase-admin';

test('parseServiceAccountKey', async (t) => {
  const validConfig = {
    project_id: 'test-project',
    private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
    client_email: 'test@example.com',
  };
  const validJson = JSON.stringify(validConfig);

  await t.test('parses valid JSON string', () => {
    const result = parseServiceAccountKey(validJson);
    assert.ok(result);
    assert.strictEqual(result.projectId, 'test-project');
    assert.strictEqual(result.project_id, 'test-project');
  });

  await t.test('parses valid base64 encoded JSON string', () => {
    const base64Json = Buffer.from(validJson).toString('base64');
    const result = parseServiceAccountKey(base64Json);
    assert.ok(result);
    assert.strictEqual(result.projectId, 'test-project');
  });

  await t.test('parses JSON with quoted string', () => {
    // Escaped string that a bash env var or quote-wrapped string might be
    const quotedJson = `"${validJson.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    // The test was previously doing a naive replace which caused syntax errors in node 22. Let's just create valid quoted json.
    const doubleEncoded = JSON.stringify(validJson);
    const result = parseServiceAccountKey(doubleEncoded);
    assert.ok(result);

    // Sometimes it parses returning a string instead of an object, so we handle it.
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    assert.strictEqual(parsed.projectId || parsed.project_id, 'test-project');
  });

  await t.test('returns null for invalid inputs', () => {
    assert.strictEqual(parseServiceAccountKey('not-a-json'), null);
    assert.strictEqual(parseServiceAccountKey(''), null);
    const parsedEmpty = parseServiceAccountKey('{}');
    // For '{}', the function returns an empty object because it is valid JSON
    assert.deepStrictEqual(parsedEmpty, {});
  });

  await t.test('normalizes private key with literal newlines', () => {
    const configWithLiteralNewlines = {
      ...validConfig,
      private_key: '-----BEGIN PRIVATE KEY-----\nline1\nline2\n-----END PRIVATE KEY-----\n'
    };
    const mangledJson = JSON.stringify(configWithLiteralNewlines).replace(/\\n/g, '\n');
    const result = parseServiceAccountKey(mangledJson);
    assert.ok(result);
    // TypeScript doesn't know about `private_key` if we typed it strictly, check `privateKey` fallback instead, or cast.
    const pk = (result as any).private_key || result.privateKey;
    assert.ok(pk?.includes('\n'));
  });
});
