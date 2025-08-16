# NOTES

- might be able to get async functions working without too much trouble as long
  as you have the rule that all signal calls have to happen before the first
  await. See https://arc.net/l/quote/qelslpmi
- you should be able to pass attributes to the dom with `hlx(...attrs)`
- signal definitions should be allowed outside of components
- you should be able to ensure key uniquess across arrays without wrapping each one in an `hlx` call
