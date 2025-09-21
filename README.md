# NOTES

- to prevent injection attacks you'll need to escape keywords before parsing
- might be able to get async components working without too much trouble as long
  as you have the rule that all signal calls have to happen before the first
  await. See https://arc.net/l/quote/qelslpmi
- you should be able to pass attributes to the dom with `hlx(...attrs)`
