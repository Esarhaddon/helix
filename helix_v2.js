const phraseTypes = {
  IDENTIFIER: "identifier",
  // DEV: eventually, you won't use this for event listeners
  ATTRIBUTE: "attribute",
  HTML: "html",
  // DEV: not quite sure what to do with these rn
  SLOT: "slot",
  COMPONENT: "component",
};

function isMergeable(phrase) {
  return (
    phrase &&
    phrase.type !== phraseTypes.IDENTIFIER &&
    phrase.type !== phraseTypes.ATTRIBUTE &&
    phrase.type !== phraseTypes.COMPONENT
  );
}

// TODO: There's probably a performance cost to not doing this on the fly
function mergePhrases(phrases) {
  return phrases.reduce((acc, phrase) => {
    if (!acc.length) {
      return [phrase];
    } else {
      const prev = acc.at(-1);

      if (isMergeable(prev) && isMergeable(phrase)) {
        return [
          ...acc.slice(0, -1),
          { ...prev, value: prev.value + phrase.value },
        ];
      } else {
        return [...acc, phrase];
      }
    }
  }, []);
}

//

// DEV: this isn't quite right?
// - what affect does this have on when html is actually parsed (when rendering
//   or when the file first runs)?
//   - probably matters for perf
// - how exactly does this work again?
function helix() {
  return function hlx(stringsOrConfig, ...children) {
    if (Array.isArray(stringsOrConfig)) {
      const strings = stringsOrConfig;
      return getTemplateBuilderV2(undefined, strings, ...children)();
    } else if (typeof stringsOrConfig === "string") {
      const key = stringsOrConfig;
      return getTemplateBuilderV2(key);
    } else {
      const config = stringsOrConfig;
      return getTemplateBuilderV2(config.key);
    }
  };
}

// DEV: this will need to include components
function getTemplateBuilderV2(key, defaultStrings, ...defaultChildren) {
  return (strings, ...children) => {
    const htmlFragments = [...(strings || defaultStrings)];

    htmlFragments[0] = htmlFragments[0].trimLeft();
    htmlFragments[htmlFragments.length - 1] =
      htmlFragments[htmlFragments.length - 1].trimRight();

    return {
      _isTemplateNode: true,
      assignedkey: key,
      hash: htmlFragments.join("_"),
      htmlFragments,
      // DEV: hmm
      templateChildren: children.length ? children : defaultChildren,
    };
  };
}

// DEV: there might be a few places you can collapse identifiers
// - component children
// - the first node in a template
// - the trailing identifier for an array item
// - maybe don't worry about it for now though

// DEV: recursion would probably be a better pattern than the stack pattern that
// you came up with
// - actually maybe not since in order to know the hash of some nested html that
//   isn't a separate template, you have to parse it anyway

// DEV: you should hold off on parsing until you know it's time to render
// - would probably be a performance boost for apps with lots of components
function parseTemplateInPlaceV2(template) {
  let isOpeningTag = false;
  let isClosingTag = false;
  let isComponentTag = false;
  let isAttr = false;

  const result = [];
  const levelsStack = [{ suffix: [0], phrases: result }];

  // DEV: seems like this logic might not be quite right
  // - pretty sure the suffix should be shared at all levels since everything
  //   being parsed is part of the same template string

  // DEV: yeah, you shouldn't be building up an array within a template, just
  // within nested templates
  // - suffix should just be a counter that gets incremented
  function getSuffix() {
    return [...levelsStack[0].suffix];
  }

  function incSuffix() {
    const suffix = levelsStack[0].suffix;
    suffix[suffix.length - 1]++;
  }

  function prevSuffix() {
    return [
      ...levelsStack
        .at(-1)
        .phrases.findLast((phrase) => phrase.type === phraseTypes.IDENTIFIER)
        .suffix,
    ];
  }

  function prevPhrase() {
    return levelsStack.at(-1).phrases.at(-1);
  }

  function pushPhrase(phrase) {
    levelsStack.at(-1).phrases.push(phrase);
  }

  template.parsedHtmlFragments = result;

  template.htmlFragments.forEach((fragment, i) => {
    // Add a closing identifier for slots
    if (!isOpeningTag && !isClosingTag && i !== 0) {
      pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: prevSuffix() });
      // incSuffix();
    }

    let unparsedFragment = fragment;
    while (unparsedFragment.length) {
      let controlCharsIndex = unparsedFragment.split("").findIndex(
        (char, i) =>
          // Opening tag start
          (!isOpeningTag &&
            !isAttr &&
            char === "<" &&
            unparsedFragment[i + 1] !== "/") ||
          // Attribute start or end
          (isOpeningTag && char === '"') ||
          // Closing tag start (only matters for component tags)
          (levelsStack.length > 1 &&
            !isOpeningTag &&
            !isAttr &&
            char === "<" &&
            unparsedFragment[i + 1] === "/") ||
          // Tag end
          (((isOpeningTag && !isAttr) || isClosingTag) && char === ">")
      );

      if (controlCharsIndex < 0 && !isComponentTag) {
        pushPhrase({ type: phraseTypes.HTML, value: unparsedFragment });

        break;
      }

      let controlChars =
        unparsedFragment[controlCharsIndex] === "<" &&
        unparsedFragment[controlCharsIndex + 1] === "/"
          ? "</"
          : unparsedFragment[controlCharsIndex];

      switch (controlChars) {
        case "<":
          if (controlCharsIndex !== 0) {
            pushPhrase({
              type: phraseTypes.HTML,
              value: unparsedFragment.slice(0, controlCharsIndex),
            });
          }

          if (/[A-Z]/.test(unparsedFragment[controlCharsIndex + 1])) {
            isComponentTag = true;

            // Don't increment the suffix since this is an opening tag
            pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: getSuffix() });
            incSuffix();
          }

          pushPhrase({ type: phraseTypes.HTML, tagStart: true, value: "<" });

          if (isComponentTag) {
            Object.assign(prevPhrase(), {
              isComponentTag: true, // DEV: you should be able to get rid of this on the phrase
              type: phraseTypes.COMPONENT,
              tagName: unparsedFragment.slice(
                controlCharsIndex + 1,
                controlCharsIndex +
                  1 +
                  unparsedFragment
                    .slice(controlCharsIndex + 1)
                    .split("")
                    // TODO: figure out what characters should be allowed in
                    // component names
                    .findIndex((char) => !/[a-z0-9]/i.test(char))
              ),
              isOpeningTag: true,
              value: "",
              parsedHtmlFragments: [],
            });
          }

          isOpeningTag = true;

          break;
        case '"':
          if (!isComponentTag) {
            pushPhrase({
              type: phraseTypes.HTML,
              value: unparsedFragment.slice(0, controlCharsIndex + 1),
            });
          } else if (!isAttr) {
            // Handle interpolated component attributes

            const name = unparsedFragment.slice(
              unparsedFragment
                .slice(0, controlCharsIndex - 1)
                .lastIndexOf(" ") + 1,
              controlCharsIndex - 1
            );

            const value = unparsedFragment.slice(
              controlCharsIndex + 1,
              controlCharsIndex +
                1 +
                unparsedFragment.slice(controlCharsIndex + 1).indexOf('"')
            );

            prevPhrase().attrs ||= [];
            prevPhrase().attrs.push({ name, value });
          }

          isAttr = !isAttr;

          break;
        case "</":
          if (/[A-Z]/.test(unparsedFragment[controlCharsIndex + 2])) {
            isComponentTag = true;
          }

          pushPhrase({
            type: phraseTypes.HTML,
            value: unparsedFragment.slice(
              0,
              isComponentTag ? controlCharsIndex : controlCharsIndex + 2
            ),
          });

          if (isComponentTag) {
            levelsStack.at(-1).parent.parsedHtmlFragments = mergePhrases(
              levelsStack.at(-1).phrases
            );
            levelsStack.pop();
          }

          isClosingTag = true;

          break;
        case ">":
          if (!isComponentTag) {
            pushPhrase({
              type: phraseTypes.HTML,
              value: unparsedFragment.slice(0, controlCharsIndex + 1),
            });
          } else if (
            isOpeningTag &&
            unparsedFragment[controlCharsIndex - 1] !== "/"
          ) {
            levelsStack.push({
              parent: prevPhrase(),
              suffix: [...getSuffix(), 0],
              phrases: prevPhrase().parsedHtmlFragments,
            });
          } else if (
            isClosingTag ||
            unparsedFragment[controlCharsIndex - 1] === "/"
          ) {
            pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: prevSuffix() });
            // incSuffix();
          }

          isClosingTag = false;
          isOpeningTag = false;
          isComponentTag = false;

          break;
      }

      unparsedFragment = controlChars
        ? unparsedFragment.slice(controlCharsIndex + controlChars.length)
        : "";

      // Handle component props and interpolated attributes
      if (
        !unparsedFragment &&
        isComponentTag &&
        isOpeningTag &&
        prevPhrase().isComponentTag
      ) {
        if (fragment.endsWith(" ")) {
          prevPhrase().props ||= [];
          prevPhrase().props.push({ templateChildIndex: i });
        } else if (fragment.endsWith("=")) {
          prevPhrase().attrs ||= [];
          prevPhrase().attrs.push({
            templateChildIndex: i,
            name: fragment.slice(fragment.lastIndexOf(" ") + 1, -1),
          });
        }
      }
    }

    // Handle slots and non-component attributes
    if (
      !isOpeningTag &&
      !isClosingTag &&
      i !== template.htmlFragments.length - 1
    ) {
      // Don't increment the suffix since this marks the beginning of the slot
      pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: getSuffix() });
      incSuffix();
      pushPhrase({
        type: phraseTypes.SLOT,
        templateChildIndex: i,
        type: "slot",
      });
    } else if (isOpeningTag && !isComponentTag) {
      const phrases = levelsStack.at(-1).phrases;
      const start = phrases.findLastIndex((phrase) => phrase.tagStart);

      if (
        !phrases[start - 1] ||
        !(phrases[start - 1].type !== phraseTypes.IDENTIFIER)
      ) {
        phrases.splice(start, 0, {
          type: phraseTypes.IDENTIFIER,
          suffix: getSuffix(),
        });
        incSuffix();
      }

      pushPhrase({
        type: phraseTypes.ATTRIBUTE, // DEV: type should just be an arg of pushPhrase?
        templateChildIndex: i,
        type: "attribute",
      });
    }
  });

  template.parsedHtmlFragments = mergePhrases(template.parsedHtmlFragments);
}

let currentInstanceStack = [];
let propsByKey = {};

// DEV: someday this could be streamed?

// DEV: can you treat slots just like components?

function renderToString(
  // DEV: arg
  renderKey,
  component,
  result = { html: "" }
) {
  currentInstanceStack.push({ key: renderKey });

  const template = component(propsByKey[renderKey] || {});

  // DEV: hmm
  if (!template.parsedHtmlFragments) {
    parseTemplateInPlaceV2(template);
  }

  console.log(JSON.stringify(template, null, 2));

  // DEV: are there other spots where you might need to handle prefixes?

  // DEV: parsedHtmlFragments should have a different name?
  template.parsedHtmlFragments.forEach((phrase, i) => {
    switch (phrase.type) {
      case phraseTypes.IDENTIFIER:
        // DEV: should be value for consistency?
        result.html += `<!-- ${[
          phrase.prefix || currentInstanceStack.at(-1).key,
          ...phrase.suffix.map((number) => number.toString(32)),
        ].join(" ")} -->`;
        break;
      case phraseTypes.HTML:
        result.html += phrase.value;
        break;
      case phraseTypes.ATTRIBUTE:
        result.html += `"${
          // TODO: you may need to escape this
          template.templateChildren[phrase.templateChildIndex]
        }"`;
        break;
      case phraseTypes.SLOT:
        // DEV: this is interesting
        // - should allow for truly functional components, like in React

        const templateChild =
          template.templateChildren[phrase.templateChildIndex];
        const value =
          typeof templateChild === "function" ? templateChild() : templateChild;

        if (typeof value === "number" || typeof value === "string") {
          // DEV: you need to also escape this
          result.html += value;
        } else if (typeof value === undefined || typeof value === null) {
          break;
        } else if (Array.isArray(value)) {
          // DEV: going to need to call renderToString for each item and make
          // sure they have keys
          // - each item in the array needs to be wrapped in a key that
          //   incorporates the assigned key

          if (!value.every((item) => item._isTemplateNode)) {
            throw new Error("code: 13sf5197a"); // DEV
          }

          if (!value.every((item) => item.assignedkey)) {
            throw new Error("code: 3r987asls"); // DEV
          }

          value.forEach((item) => {
            // DEV: dry this up
            const key = [
              template.parsedHtmlFragments[i - 1].prefix ||
                currentInstanceStack.at(-1).key,
              template.parsedHtmlFragments[i - 1].suffix.map((number) =>
                number.toString(32)
              ),
              item.assignedkey,
            ].join(" ");

            result.html += `<!-- ${key} -->`;
            // DEV: why is it necessary to return the item as fn?
            renderToString(key, () => item, result);
            result.html += `<!-- ${key} -->`;
          });
        } else if (typeof value === "object" && value._isTemplateNode) {
          // DEV: it's possible that this already has a qualified key

          // DEV: oof
          // - there's gotta be a better way
          const fn = () => value;
          fn.components = component.components;

          renderToString(
            [
              template.parsedHtmlFragments[i - 1].prefix ||
                currentInstanceStack.at(-1).key,
              template.parsedHtmlFragments[i - 1].suffix.map((number) =>
                number.toString(32)
              ),
            ].join(" "),
            fn,
            result
          );
        }
        break;
      case phraseTypes.COMPONENT:
        // DEV: call it scope?

        // console.log("tagName:", phrase.tagName);
        // console.log("components:", component.components);
        // console.log("component:", component.toString());

        if (
          phrase.tagName in component.components &&
          typeof component.components[phrase.tagName] === "function"
        ) {
          // DEV: you need to handle props and children here

          const key = [
            template.parsedHtmlFragments[i - 1].prefix ||
              currentInstanceStack.at(-1).key,
            template.parsedHtmlFragments[i - 1].suffix.map((number) =>
              number.toString(32)
            ),
          ].join(" ");

          if (phrase.parsedHtmlFragments.length) {
            // DEV: this should have a hash as well

            // DEV: hmm
            const templateChildren = [];
            phrase.parsedHtmlFragments.forEach((fragment) => {
              "templateChildIndex" in fragment
                ? (templateChildren[fragment.templateChildIndex] =
                    template.templateChildren[fragment.templateChildIndex])
                : null;
            });

            // DEV: qualified identifiers
            // - not sure ids are handled quite right
            // - you also need to add the hash for diffing

            // DEV: better pattern?
            const prefixPhrases = (phrase) => {
              if (phrase.type === phraseTypes.IDENTIFIER) {
                phrase.prefix = renderKey;
              } else if (phrase.type === phraseTypes.COMPONENT) {
                phrase.parsedHtmlFragments =
                  phrase.parsedHtmlFragments.map(prefixPhrases);
              }

              return phrase;
            };

            // DEV: not quite right as you need to recursively qualify these
            const children = {
              _isTemplateNode: true,
              templateChildren,
              parsedHtmlFragments:
                phrase.parsedHtmlFragments.map(prefixPhrases),
            };

            propsByKey[key] = { ...propsByKey[key], children };
          }

          renderToString(
            // DEV: you need a function for this
            [
              template.parsedHtmlFragments[i - 1].prefix ||
                currentInstanceStack.at(-1).key,
              template.parsedHtmlFragments[i - 1].suffix.map((number) =>
                number.toString(32)
              ),
            ].join(" "),
            component.components[phrase.tagName],
            result
          );
        }

        break;
    }
  });

  currentInstanceStack.pop();
  return result.html;
}

// DEV: just call it html?
const hlx = helix();

// DEV: the performance is looking quite good
function ArrayTest() {
  return hlx`
    ${new Array(3).fill(null).map((_, i) => {
      return hlx("key-" + i)`
        <div style=${"color: blue;"}>index: ${i}</div>
      `;
    })}
  `;
}

function Button({ children }) {
  console.log("the button children:", children);

  return hlx`
    <button onClick=${() => {}}>
      ${children}
    </button>
  `;
}

// DEV: sort of odd that it doesn't matter if you call this or not when you
// interpolate it?
function DoesThisWork() {
  return hlx`
    <span>this is an interpolated component</span>
  `;
}

// DEV: components can't return plain strings?
// - at least as the app root?

function WithChildren({ children }) {
  return hlx`
  <br />
  children:
  <div>
    ${children}
  </div>
`;
}

WithChildren.components = { Button, WithChildren, ArrayTest };

// DEV: hlx needs to be able to handle comments
const Component = () => {
  const nonce = Math.round(Math.random() * 1_000);

  const someUI = hlx`
    <div style=${"border: 1px dashed black;"}>this is super cool</div>
  `;

  // DEV: looks like non-interpolated children are actually being handled
  // correctly

  return hlx`
    <WithChildren>
      hello world
      <WithChildren>
        hello again
      </WithChildren>
    </WithChildren>
    <Button>
      <span>${"press me"}</span>
    </Button>
  `;

  // return hlx`
  //   <WithChildren>
  //     hello world
  //     <WithChildren>
  //       hello again
  //       <WithChildren>
  //         oh no
  //       </WithChildren>
  //     </WithChildren>
  //   </WithChildren>
  //   <Button>
  //     <span>press me</span>
  //   </Button>
  // `;

  // return hlx`
  //   <div data-nonce=${nonce}>
  //    hello world
  //   </div>
  //   <Button>
  //     ${"press me"}
  //   </Button>
  //   <ArrayTest />
  //   ${DoesThisWork}
  //   ${someUI}
  // `;
};

Component.components = { ArrayTest, Button, WithChildren };

const result = renderToString("root", Component);

console.log(result);

// DEV: hash all user-provided keys?

// DEV: hmm, looks like you're giving components extra keys?
// - don't think the root node of the component needs a separate key from the
//   component itself?

// DEV: there might be a few ways to reduce dom pollution:
// - you could omit closing keys for array items
//   - when remounting you could just replace everything up to the next array key
// - can you omit closing keys entirely?
// - if a node only has a single parent, could you omit a closing key?
// - ^^^ for any of these you would want to make sure it was resilient against
//   the framework user injecting their own dom

const root = document.getElementById("root");

root.innerHTML = result;

// DEV: next thing is probably to get children working

// const test = getTemplateBuilderV2();

// const template = test`
//   this is just a string
//   <div id="my-div">
//     <Component ${{}} id="<_adfa>k<>" ${{}} onClick=${() => {}} />
//     hello world
//     <span spanid="my-span<<><'" id=${{}} onclick=${() => {}}></span>
//     <input oninput=${() => {}} />
//   </div>
//   <div>hello world</div>
//   <Component onClick=${() => {}} id=${null}>
//     <span>
//       hello world
//       ${{}}
//       <div>even moar nested</div>
//       <AnotherComponent
//         ${{ greeting: "hello world" }}
//         class="my-class"
//       >
//         <div onclick=${() => {}}>You still need to match tags?</div>
//         <div onclick=${() => {}}>Very cool that this is working now</div>
//       </AnotherComponent>
//       does this work?
//     </span>
//   </Component>
//   <span>last little bit</span>
// `;

// console.log(JSON.stringify(template, null, 2));

// parseTemplateInPlaceV2(template);

// console.log(JSON.stringify(template, null, 2));

// DEV: for the index file, you should go with something like this:

/*

import * as components from "./app.js"

const root = createRoot.document.getElementById("root")

root.register(components)
root.render(components.App)
 
 */

// DEV: if you go the export * path you can get around having to export an hlx
// const as well by adding components to each exported fn or obj that meets your
// criteria
// - you can pass components to the rendering logic the same way that you do the
//   current instance id
// - you may need some kind of FIFO stack to track rendering comoponents

// DEV: if a js fn can tell know what file it's defined in then you might also
// be able to combine this with some kind of global registry fn
// - that's import.meta:
//   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta
// - actually wouldn't work?
// - or you'd have to do something like this:
//   - but then what about conflicts? you'd end up using components from other
//     modules whether you wanted to or not

/*

const hlx = getHlx(import.meta.url)

export Counter = hlx.c(() => {
  // ...  
})

*/

// DEV: another alternative would be to adopt an explicit import syntax like
// this:

/*

hlx.import({ 
  Counter: import("@components/counter.js")
})

// or maybe:

hlx.import("Counter", "@components/counter.js")

// I think this would still require something like the following in counter.js
// though:

const hlx = makeTemplate()

export const Counter = hlx.c(() => {
  // ...
})

export const Button = hlx.c(() => {
  // ...
})

// ^^^ would the name property get added? how ubiquitious is browser support
// for that?
// - looks like not

*/
