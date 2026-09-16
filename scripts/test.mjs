import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Capture native Buffer reference for test verification and mocks
const nativeBuffer = globalThis.Buffer;

// Helper to encode string to Uint8Array
const encodeText = (str) => new TextEncoder().encode(str);

// RFC 4648 test vectors
const RFC_VECTORS = [
  ['', ''],
  ['f', 'Zg=='],
  ['fo', 'Zm8='],
  ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='],
  ['fooba', 'Zm9vYmE='],
  ['foobar', 'Zm9vYmFy'],
];

// UTF-8 test cases
const UTF8_TEST_CASES = [
  'Hello, World!',
  '你好，世界！',
  'こんにちは世界',
  '🎉🚀✨🔥',
  'Special chars: \r\n\t\0`~!@#$%^&*()_+-=[]{}|;:\'",.<>?/',
];

/**
 * Common test runner for basic functional verification
 * @param {(bytes: Uint8Array) => string | Promise<string>} toBase64
 * @param {{ isSync?: boolean }} [options]
 */
async function testCommonFunctionality(toBase64, options = {}) {
  // 1. RFC 4648 vectors
  for (const [input, expected] of RFC_VECTORS) {
    const res = toBase64(encodeText(input));
    if (options.isSync) {
      assert.equal(typeof res, 'string', 'Expected synchronous return');
    }
    const result = await res;
    assert.equal(result, expected, `Failed for RFC vector: "${input}"`);
  }

  // 2. UTF-8 and special characters
  for (const text of UTF8_TEST_CASES) {
    const bytes = encodeText(text);
    const expected = nativeBuffer.from(bytes).toString('base64');
    const result = await toBase64(bytes);
    assert.equal(result, expected, `Mismatch for UTF-8: "${text}"`);
  }

  // 3. All 256 byte values
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const expectedAllBytes = nativeBuffer.from(allBytes).toString('base64');
  assert.equal(await toBase64(allBytes), expectedAllBytes);

  // 4. Padding lengths (0..64)
  for (let len = 0; len <= 64; len++) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = (i * 31 + 17) & 0xff;
    }
    const expected = nativeBuffer.from(bytes).toString('base64');
    assert.equal(await toBase64(bytes), expected, `Failed at length ${len}`);
  }

  // 5. Uint8Array subarray with byteOffset
  const underlying = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
  const sub = underlying.subarray(2, 6); // [30, 40, 50, 60]
  const expectedSub = nativeBuffer.from(sub).toString('base64');
  assert.equal(await toBase64(sub), expectedSub);

  // 6. Large data (64 KB)
  const size = 64 * 1024;
  const largeData = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    largeData[i] = (i ^ (i >> 8)) & 0xff;
  }
  const expectedLarge = nativeBuffer.from(largeData).toString('base64');
  assert.equal(await toBase64(largeData), expectedLarge);
}

/**
 * Mock FileReader for testing browser fallback paths in Node.js
 */
class MockFileReader {
  static shouldFail = false;

  constructor() {
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onerror = null;
  }

  readAsDataURL(blob) {
    queueMicrotask(async () => {
      if (MockFileReader.shouldFail) {
        this.error = new Error('Mock FileReader error');
        if (typeof this.onerror === 'function') this.onerror();
        return;
      }
      try {
        const buf = await blob.arrayBuffer();
        const base64 = nativeBuffer.from(buf).toString('base64');
        this.result = `data:application/octet-stream;base64,${base64}`;
        if (typeof this.onload === 'function') this.onload();
      } catch (err) {
        this.error = err;
        if (typeof this.onerror === 'function') this.onerror();
      }
    });
  }
}

describe('node.mjs', async () => {
  const { default: nodeToBase64 } = await import('../node.mjs');

  it('should return a string synchronously', () => {
    const res = nodeToBase64(encodeText('foobar'));
    assert.equal(typeof res, 'string');
    assert.equal(res, 'Zm9vYmFy');
  });

  it('should pass all common functional tests', async () => {
    await testCommonFunctionality(nodeToBase64, { isSync: true });
  });

  it('should correctly handle multi-sliced subarrays with non-zero offsets', () => {
    const buf = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const sub1 = buf.subarray(3, 7); // [3, 4, 5, 6]
    assert.equal(nodeToBase64(sub1), nativeBuffer.from([3, 4, 5, 6]).toString('base64'));

    const sub2 = sub1.subarray(1, 3); // [4, 5]
    assert.equal(nodeToBase64(sub2), nativeBuffer.from([4, 5]).toString('base64'));
  });
});

describe('browser.mjs', async () => {
  describe('Native Uint8Array.prototype.toBase64 branch', async () => {
    it('should use native toBase64 if available and return synchronously', async () => {
      if (typeof Uint8Array.prototype.toBase64 !== 'function') return;

      const { default: browserToBase64 } = await import(`../browser.mjs?env=native_${Date.now()}`);
      const res = browserToBase64(encodeText('foobar'));
      assert.equal(typeof res, 'string');
      assert.equal(res, 'Zm9vYmFy');

      await testCommonFunctionality(browserToBase64, { isSync: true });
    });
  });

  describe('Fallback branch (Blob + FileReader)', async () => {
    const origToBase64 = Uint8Array.prototype.toBase64;
    const origFileReader = globalThis.FileReader;

    it('should fallback to FileReader and return a Promise', async () => {
      try {
        delete Uint8Array.prototype.toBase64;
        globalThis.FileReader = MockFileReader;
        MockFileReader.shouldFail = false;

        const { default: browserToBase64 } = await import(`../browser.mjs?env=fr_${Date.now()}`);

        const promise = browserToBase64(encodeText('foobar'));
        assert.ok(promise instanceof Promise, 'Expected a Promise');
        assert.equal(await promise, 'Zm9vYmFy');

        await testCommonFunctionality(browserToBase64, { isSync: false });
      } finally {
        if (origToBase64) Uint8Array.prototype.toBase64 = origToBase64;
        if (origFileReader !== undefined) {
          globalThis.FileReader = origFileReader;
        } else {
          delete globalThis.FileReader;
        }
      }
    });

    it('should handle Blob construction fallback when direct new Blob([bytes]) throws', async () => {
      const origBlob = globalThis.Blob;
      let mockBlobTriggered = false;
      const targetBytes = new Uint8Array([100, 101, 102]);

      try {
        delete Uint8Array.prototype.toBase64;
        globalThis.FileReader = MockFileReader;
        MockFileReader.shouldFail = false;

        // Simulate environments where new Blob([Uint8Array]) throws (e.g. SharedArrayBuffer)
        globalThis.Blob = class extends origBlob {
          constructor(parts, options) {
            if (parts?.[0] === targetBytes && !mockBlobTriggered) {
              mockBlobTriggered = true;
              throw new TypeError('Simulated SharedArrayBuffer or typed array error');
            }
            super(parts, options);
          }
        };

        const { default: browserToBase64 } = await import(`../browser.mjs?env=sab_${Date.now()}`);
        const result = await browserToBase64(targetBytes);

        assert.ok(mockBlobTriggered, 'Mock Blob throw was triggered');
        assert.equal(result, nativeBuffer.from(targetBytes).toString('base64'));
      } finally {
        globalThis.Blob = origBlob;
        if (origToBase64) Uint8Array.prototype.toBase64 = origToBase64;
        if (origFileReader !== undefined) {
          globalThis.FileReader = origFileReader;
        } else {
          delete globalThis.FileReader;
        }
      }
    });

    it('should reject Promise when FileReader errors', async () => {
      try {
        delete Uint8Array.prototype.toBase64;
        globalThis.FileReader = MockFileReader;
        MockFileReader.shouldFail = true;

        const { default: browserToBase64 } = await import(`../browser.mjs?env=fr_err_${Date.now()}`);

        await assert.rejects(
          async () => {
            await browserToBase64(new Uint8Array([1, 2, 3]));
          },
          {
            message: 'Mock FileReader error',
          }
        );
      } finally {
        MockFileReader.shouldFail = false;
        if (origToBase64) Uint8Array.prototype.toBase64 = origToBase64;
        if (origFileReader !== undefined) {
          globalThis.FileReader = origFileReader;
        } else {
          delete globalThis.FileReader;
        }
      }
    });
  });
});

describe('main.js (Universal entry)', async () => {
  const { default: mainToBase64 } = await import('../main.js');

  it('should pass all common functional tests in default environment', async () => {
    await testCommonFunctionality(mainToBase64);
  });

  it('should test native toBase64 branch', async () => {
    if (typeof Uint8Array.prototype.toBase64 !== 'function') return;
    const { default: toBase64 } = await import(`../main.js?env=native_${Date.now()}`);
    const res = toBase64(encodeText('foobar'));
    assert.equal(typeof res, 'string');
    assert.equal(res, 'Zm9vYmFy');
  });

  it('should test Buffer.prototype.base64Slice branch', async () => {
    const origToBase64 = Uint8Array.prototype.toBase64;
    try {
      delete Uint8Array.prototype.toBase64;
      const { default: toBase64 } = await import(`../main.js?env=buffer_${Date.now()}`);
      const res = toBase64(encodeText('foobar'));
      assert.equal(typeof res, 'string');
      assert.equal(res, 'Zm9vYmFy');
      await testCommonFunctionality(toBase64, { isSync: true });
    } finally {
      if (origToBase64) Uint8Array.prototype.toBase64 = origToBase64;
    }
  });

  it('should test FileReader fallback branch and error handling', async () => {
    const origBuffer = globalThis.Buffer;
    const origToBase64 = Uint8Array.prototype.toBase64;
    const origFileReader = globalThis.FileReader;

    try {
      delete Uint8Array.prototype.toBase64;
      globalThis.Buffer = undefined;
      globalThis.FileReader = MockFileReader;
      MockFileReader.shouldFail = false;

      const { default: toBase64 } = await import(`../main.js?env=filereader_${Date.now()}`);
      const promise = toBase64(encodeText('foobar'));
      assert.ok(promise instanceof Promise);
      assert.equal(await promise, 'Zm9vYmFy');

      // Test error rejection
      MockFileReader.shouldFail = true;
      await assert.rejects(
        async () => {
          await toBase64(new Uint8Array([1, 2, 3]));
        },
        { message: 'Mock FileReader error' }
      );
    } finally {
      MockFileReader.shouldFail = false;
      if (origToBase64) Uint8Array.prototype.toBase64 = origToBase64;
      globalThis.Buffer = origBuffer;
      if (origFileReader !== undefined) {
        globalThis.FileReader = origFileReader;
      } else {
        delete globalThis.FileReader;
      }
    }
  });
});

describe('Package Exports Resolution', async () => {
  it('should resolve "mini-to-base64" to node.mjs in Node environment', async () => {
    const pkg = await import('mini-to-base64');
    const nodePkg = await import('../node.mjs');

    assert.equal(pkg.default, nodePkg.default);

    const res = pkg.default(encodeText('foobar'));
    assert.equal(res, 'Zm9vYmFy');
  });
});
