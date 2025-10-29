# Helix

Helix is a modern, lightweight JSX/React alternative that does not require a
compiler and can run directly in the browser.

## Getting started

In `app.js` add:

```javascript
import { helix, useSignal } from "./helix.js";

export const hlx = helix();

export function Counter() {
  const count = useSignal(0);

  return hlx`
    <div>${count.value}</div>
    <button onclick=${() => count.value++}>↑</button>
    <button onclick=${() => count.value--}>↓</button>
  `;
}
```

And in `index.html` add:

```html
<!DOCTYPE html>
<html>
  <head>
    <script type="module">
      import { createRoot } from "./helix.js";
      import * as components from "./app.js";

      const root = createRoot(document.getElementById("root"), components);
      root.render(components.Counter);
    </script>
  </head>
  <body>
    <div id="root">loading...</div>
  </body>
</html>
```

Run `npx serve .` and visit your new Helix app at `localhost:3000`.
