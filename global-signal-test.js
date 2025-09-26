import helix from "./helix.js";
import { globalSignal } from "./app.js";

export const hlx = helix();

export function GlobalSignalTest() {
  return hlx`
      <div>global signal test: ${globalSignal.value}</div>
    `;
}
