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

// DEV: this will need to include components
function getTemplateBuilderV2(key, defaultStrings, ...defaultChildren) {
  return (strings, ...children) => {
    const htmlFragments = [...(strings || defaultStrings)];

    htmlFragments[0] = htmlFragments[0].trimLeft();
    htmlFragments[htmlFragments.length - 1] =
      htmlFragments[htmlFragments.length - 1].trimRight();

    return {
      _isTemplateNode: true,
      assignedKey: key,
      hash: htmlFragments.join("_"),
      htmlFragments,
      templateChildren: children || defaultChildren,
    };
  };
}

// DEV: you should hold off on parsing until you know it's time to render
function parseTemplateInPlaceV2(template) {
  let isOpeningTag = false;
  let isClosingTag = false;
  let isComponentTag = false;
  let isAttr = false;

  const result = [];
  const levelsStack = [{ suffix: [0], phrases: result }];

  function getSuffix() {
    return [...levelsStack.at(-1).suffix];
  }

  function incSuffix() {
    const suffix = levelsStack.at(-1).suffix;
    suffix[suffix.length - 1]++;
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
      pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: getSuffix() });
      incSuffix();
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

            levelsStack.at(-1).parent.parsedHtmlFragments = mergePhrases(
              levelsStack.at(-1).phrases
            );
            levelsStack.pop();
          }

          if (!isComponentTag) {
            pushPhrase({
              type: phraseTypes.HTML,
              value: unparsedFragment.slice(0, controlCharsIndex + 2),
            });
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
            const suffix = getSuffix();
            console.log({ suffix });

            levelsStack.push({
              parent: prevPhrase(),
              suffix: [...getSuffix(), 0],
              phrases: prevPhrase().parsedHtmlFragments,
            });
          } else if (
            isClosingTag ||
            unparsedFragment[controlCharsIndex - 1] === "/"
          ) {
            pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: getSuffix() });
            incSuffix();
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

// DEV: someday this could be streamed?

// DEV: can you treat slots just like components?
function renderToString(key, component, result = { html: "" }) {
  currentInstanceStack.push({ key });

  const template = component();
  parseTemplateInPlaceV2(template);
  console.log(JSON.stringify(template, null, 2));

  // DEV:
  // - switch on fragment type and append to result.html
  // - every time you encounter a component, call renderToString for that
  //   component

  // DEV: parsedHtmlFragments should have a different name?
  template.parsedHtmlFragments.forEach((phrase, i) => {
    switch (phrase.type) {
      case phraseTypes.IDENTIFIER:
        // DEV: should be value for consistency?
        result.html += `<!-- ${[
          currentInstanceStack.at(-1).key,
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

        // DEV: whoops, these aren't quite right since they'll be phrases with a
        // templateChildIndex set

        // const value =
        // typeof phrase.value === "function" ? phrase.value() : phrase.value;

        if (typeof value === "number" || typeof value === "string") {
          // DEV: you need to also escape this
          result.html += value;
        } else if (typeof value === undefined || typeof value === null) {
          break;
        } else if (Array.isArray(value)) {
          // DEV: going to need to call renderToString for each item and make
          // sure they have keys
        } else if (typeof value === "object" && value._isTemplateNode) {
          renderToString(
            [
              currentInstanceStack.at(-1).key,
              template.parsedHtmlFragments[i - 1].suffix.map((number) =>
                number.toString(32)
              ),
            ].join(" "),
            // DEV: might be able to better consolidate the handling of slots
            // and components?
            () => template.templateChildren[phrase.templateChildIndex],
            result
          );
        }
        break;
      case phraseTypes.COMPONENT:
        // DEV: call it scope?
        if (
          phrase.tagName in component.components &&
          typeof component.components[phrase.tagName] === "function"
        ) {
          renderToString(
            // DEV: you need a function for this
            [
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

const hlx = getTemplateBuilderV2();

function Button() {
  return hlx`
    <button onClick=${() => {}}>
      press me
    </button>
  `;
}

const Component = () => {
  const nonce = Math.round(Math.random() * 1_000);

  return hlx`
    <div data-nonce=${nonce}>
      hello world ${42}
      ${hlx`
        <span id=${"my-span"}>this is a slot</span>
      `}
      <Button />
    </div>
  `;
};

Component.components = { Button };

const result = renderToString("root", Component);

console.log(result);

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
