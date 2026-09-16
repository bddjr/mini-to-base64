// mini-to-base64 (Node.js)
// Fast Base64 encoder using native APIs.

// Deno: `Buffer.prototype.base64Slice` throws error when arguments are omitted
// https://github.com/denoland/deno/issues/34286

/** @type {(bytes: Uint8Array) => string | Promise<string>} */
export default (bytes) => Buffer.prototype.base64Slice.call(bytes, 0, bytes.length)
