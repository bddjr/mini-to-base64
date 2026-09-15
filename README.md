# mini to base64

Fast Base64 encoder using native APIs.

```
npm i mini-to-base64@latest
```

```js
import miniToBase64 from "mini-to-base64"

let data = Uint8Array.of(127, 255, 254, 8)

// returns: string | Promise<string>
let b64 = await miniToBase64(data) // "f//+CA=="
```
