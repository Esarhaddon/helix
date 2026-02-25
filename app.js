import helix, { useSignal } from "./helix.js";

export const hlx = helix();

export function Counter() {
  const count = useSignal(0);

  return hlx`
    <div>${count.value}</div>
    <button onclick=${() => count.value++}>↑</button>
    <button onclick=${() => count.value--}>↓</button>
  `;
}

export function App() {
  return hlx`
    <Counter />
  `;
}
