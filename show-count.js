import helix from "./helix.js";

import { count } from "./app.js";

export const hlx = helix();

export function ShowCount() {
  return hlx`
    <div>${count.value}</div>
  `;
}
