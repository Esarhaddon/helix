import helix, { createRoot, createSignal, useSignal } from "./helix.js";

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

export function Counter() {
  const count = useSignal(0);

  return hlx`
    <div>${count.value}</div>
    <button onclick=${() => count.value++}>↑</button>
    <button onclick=${() => count.value--}>↓</button>
    ${count.value > 5 ? hlx`<span>count is over 5!</span>` : ""}
    <div>global signal value: ${globalSignal.value}</div>
  `;
}

export function Count({ count }) {
  return hlx` <div>The count is: ${count}</div> `;
}

export function ChildrenTest({ children } = {}) {
  return hlx`
    <div>rendering children:</div>
    <div>
      ${children}
    </div>
  `;
}

export function App() {
  const test = useSignal({ the: { count: 0 } });
  const formState = useSignal({});

  return hlx`
    <Count ...${{
      count: hlx`<span>${test.value.the.count}</span>`,
    }}
    />
    <button onclick=${() => test.value.the.count++}>inc</button>
    <Counter />
    <input
      placeholder="global value"
      value=${globalSignal.value}
      oninput=${(e) => (globalSignal.value = e.target.value)}
    />
    <ChildrenTest>
     ${new Array(4).fill(null).map(
       (_, index) => hlx(index.toString())`
         <div>
          <Input ...${{ formState, index }} />
         </div>
       `
     )}
    </ChildrenTest>
    <GlobalSignalTest />
    <p>array test:</p>
    <ArrayTest />
  `;
}
