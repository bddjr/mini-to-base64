// mini-to-base64 (browser)
// Fast Base64 encoder using native APIs.

/** @type {(bytes: Uint8Array) => string | Promise<string>} */
export default (
    typeof Uint8Array.prototype.toBase64 == 'function' // ES2026
        ? (bytes) => bytes.toBase64()
        : (bytes) => new Promise((resolve, reject) => {
            let blob;
            try {
                blob = new Blob([/** @type {Uint8Array<ArrayBuffer>} */(bytes)]);
            } catch (e) {
                // Uint8Array<SharedArrayBuffer>
                blob = new Blob([new Uint8Array(bytes)]);
            }
            const fr = new FileReader;
            fr.onerror = () => reject(fr.error);
            fr.onload = () => {
                const s = /** @type {string} */(fr.result);
                resolve(s.slice(s.indexOf(',') + 1));
            };
            fr.readAsDataURL(blob);
        })
);
