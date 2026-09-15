import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

describe('mini-to-base64 (Default environment)', async () => {
  const { default: miniToBase64 } = await import('../main.js');

  it('should encode RFC 4648 standard test vectors', async () => {
    for (const [input, expected] of RFC_VECTORS) {
      const result = await miniToBase64(encodeText(input));
      assert.equal(result, expected, `Failed for input: "${input}"`);
    }
  });

  it('should correctly encode UTF-8 and special characters', async () => {
    const testCases = [
      'Hello, World!',
      '你好，世界！',
      'こんにちは世界',
      '🎉🚀✨🔥',
      'Special chars: \r\n\t\0`~!@#$%^&*()_+-=[]{}|;:\'",.<>?/',
    ];

    for (const text of testCases) {
      const bytes = encodeText(text);
      const expected = Buffer.from(bytes).toString('base64');
      const result = await miniToBase64(bytes);
      assert.equal(result, expected, `Mismatch for: "${text}"`);
    }
  });

  it('should correctly handle all byte values from 0 to 255', async () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i;
    }
    const expected = Buffer.from(allBytes).toString('base64');
    const result = await miniToBase64(allBytes);
    assert.equal(result, expected);
  });

  it('should correctly encode various byte lengths (padding coverage)', async () => {
    for (let len = 0; len <= 64; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (i * 31 + 17) & 0xff;
      }
      const expected = Buffer.from(bytes).toString('base64');
      const result = await miniToBase64(bytes);
      assert.equal(result, expected, `Failed at length ${len}`);
    }
  });

  it('should correctly handle Uint8Array subarrays with byteOffset', async () => {
    const underlying = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const sub = underlying.subarray(2, 6); // [30, 40, 50, 60]

    const expected = Buffer.from(sub).toString('base64');
    const result = await miniToBase64(sub);
    assert.equal(result, expected);
  });

  it('should handle large data (64 KB) efficiently', async () => {
    const size = 64 * 1024;
    const largeData = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      largeData[i] = (i ^ (i >> 8)) & 0xff;
    }
    const expected = Buffer.from(largeData).toString('base64');
    const result = await miniToBase64(largeData);
    assert.equal(result, expected);
  });
});

describe('Branch 1: Native Uint8Array.prototype.toBase64', async () => {
  it('should use Uint8Array.prototype.toBase64 and return a string synchronously', async () => {
    if (typeof Uint8Array.prototype.toBase64 !== 'function') {
      return; // Skip if runtime does not support native toBase64
    }

    const { default: toBase64 } = await import(`../main.js?env=native_${Date.now()}`);
    const input = encodeText('foobar');
    const result = toBase64(input);

    assert.equal(typeof result, 'string');
    assert.equal(result, 'Zm9vYmFy');
  });
});

describe('Branch 2: Buffer.prototype.base64Slice', async () => {
  it('should use base64Slice when Uint8Array.prototype.toBase64 is unavailable', async () => {
    const origToBase64 = Uint8Array.prototype.toBase64;
    try {
      delete Uint8Array.prototype.toBase64;

      const { default: toBase64 } = await import(`../main.js?env=buffer_${Date.now()}`);
      
      // Test synchronous string return
      const res = toBase64(encodeText('foobar'));
      assert.equal(typeof res, 'string');
      assert.equal(res, 'Zm9vYmFy');

      // Test RFC vectors
      for (const [input, expected] of RFC_VECTORS) {
        assert.equal(toBase64(encodeText(input)), expected);
      }

      // Test subarray with offset
      const sub = new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(1, 4);
      assert.equal(toBase64(sub), Buffer.from(sub).toString('base64'));

      // Test full byte range 0..255
      const allBytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) allBytes[i] = i;
      assert.equal(toBase64(allBytes), Buffer.from(allBytes).toString('base64'));
    } finally {
      if (origToBase64) {
        Uint8Array.prototype.toBase64 = origToBase64;
      }
    }
  });
});

describe('Branch 3: Fallback (Blob + FileReader)', async () => {
  const origBuffer = globalThis.Buffer;
  const origToBase64 = Uint8Array.prototype.toBase64;
  const origFileReader = globalThis.FileReader;

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
          this.error = new Error('Mock FileReader failure');
          if (typeof this.onerror === 'function') this.onerror();
          return;
        }
        try {
          const buf = await blob.arrayBuffer();
          const base64 = origBuffer.from(buf).toString('base64');
          this.result = `data:application/octet-stream;base64,${base64}`;
          if (typeof this.onload === 'function') this.onload();
        } catch (err) {
          this.error = err;
          if (typeof this.onerror === 'function') this.onerror();
        }
      });
    }
  }

  it('should use FileReader fallback returning a Promise when native/Buffer are unavailable', async () => {
    try {
      delete Uint8Array.prototype.toBase64;
      globalThis.Buffer = undefined;
      globalThis.FileReader = MockFileReader;
      MockFileReader.shouldFail = false;

      const { default: toBase64 } = await import(`../main.js?env=filereader_${Date.now()}`);

      // Verify return type is a Promise
      const promise = toBase64(encodeText('foobar'));
      assert.ok(promise instanceof Promise, 'Expected return value to be a Promise');

      const result = await promise;
      assert.equal(result, 'Zm9vYmFy');

      // Test RFC vectors
      for (const [input, expected] of RFC_VECTORS) {
        const res = await toBase64(encodeText(input));
        assert.equal(res, expected);
      }

      // Test subarray with offset
      const sub = new Uint8Array([9, 8, 7, 6, 5, 4]).subarray(2, 5);
      const subRes = await toBase64(sub);
      assert.equal(subRes, origBuffer.from(sub).toString('base64'));
    } finally {
      if (origToBase64) Uint8Array.prototype.toBase64 = origToBase64;
      globalThis.Buffer = origBuffer;
      if (origFileReader !== undefined) {
        globalThis.FileReader = origFileReader;
      } else {
        delete globalThis.FileReader;
      }
    }
  });

  it('should reject Promise when FileReader encounters an error', async () => {
    try {
      delete Uint8Array.prototype.toBase64;
      globalThis.Buffer = undefined;
      globalThis.FileReader = MockFileReader;
      MockFileReader.shouldFail = true;

      const { default: toBase64 } = await import(`../main.js?env=filereader_err_${Date.now()}`);

      await assert.rejects(
        async () => {
          await toBase64(new Uint8Array([1, 2, 3]));
        },
        {
          message: 'Mock FileReader failure',
        }
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
