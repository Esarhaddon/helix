import helix, { createRoot, createSignal, useSignal } from "./helix.js";
import { ShowCount } from "./show-count.js";

export * as Input from "./input.js";
export * as GlobalSignalTest from "./global-signal-test.js";

export const hlx = helix();

export function ArrayTest() {
  const formState = useSignal({});

  return hlx`${Array(1_000)
    .fill(null)
    .map(
      (_, index) => hlx(index.toString())`
        ${index > 0 ? hlx`<br/>` : ""}
        <Input ...${{ formState, index }} />
      `
    )}`;
}

export const globalSignal = createSignal("");

export function Count({ count }) {
  return hlx`<div>The count is: ${count}</div>`;
}

export function ChildrenTest({ children } = {}) {
  return hlx`
    <div>rendering children:</div>
    <div>
      ${children}
    </div>
  `;
}

export function ThisShouldNotBreak() {
  const count = useSignal(0);

  return count.value < 3
    ? hlx`
        <div>count is under 3: ${count.value}</div>
        <button onclick=${() => count.value++}>+</button>
        <button onclick=${() => count.value--}>-</button>
      `
    : hlx`
        <div>count is equal to or over 3: ${count.value}</div>
        <button onclick=${() => count.value++}>+</button>
        <button onclick=${() => count.value--}>-</button>
      `;
}

export const count = createSignal(0);

export * as ShowCount from "./show-count.js";

export function Counter() {
  // const count = useSignal(0);

  return hlx`
    <div>${count.value}</div>
    <button onclick=${() => count.value++}>↑</button>
    <button onclick=${() => count.value--}>↓</button>
  `;
}

export function App() {
  return hlx`
    <Counter />
    <br />
    show count:
    <ShowCount />
  `;
}
