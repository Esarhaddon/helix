function Input({ formState, index }) {
  return hlx`
    <input 
      value=${formState.value[index]}
      oninput=${(event) => {
        formState.value = {
          ...formState.value,
          [index]: event.target.value,
        };
      }}
    />
  `;
}
