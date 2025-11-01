import helix from "./helix.js";

export const hlx = helix();

export function Input({ formState, index }) {
  console.log(["Input called..."]);

  return hlx`
    <input 
      value=${formState.value[index]}
      oninput=${(event) => {
        formState.value[index] = event.target.value;
      }}
    />
  `;
}
