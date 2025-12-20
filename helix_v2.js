const phraseTypes = {
  IDENTIFIER: "identifier",
  ATTRIBUTE: "attribute",
  HTML: "html",
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

// TODO: you don't need a separate fn for this
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
      templateChildren: children.length ? children : defaultChildren,
    };
  };
}

const cache = {};

function parseTemplateInPlaceV2(template) {
  let isOpeningTag = false;
  let isClosingTag = false;
  let isComponentTag = false;
  let isAttr = false;

  const result = cache[template.hash] || [];
  template.parsedHtmlFragments = result;

  if (result.length) {
    return;
  }

  let suffix = 0;
  const levelsStack = [{ phrases: result }];

  function prevSuffix() {
    return levelsStack
      .at(-1)
      .phrases.findLast((phrase) => phrase.type === phraseTypes.IDENTIFIER)
      .suffix;
  }

  function prevPhrase() {
    return levelsStack.at(-1).phrases.at(-1);
  }

  function pushPhrase(phrase) {
    levelsStack.at(-1).phrases.push(phrase);
  }

  template.htmlFragments.forEach((fragment, i) => {
    // Add a closing identifier for slots
    if (!isOpeningTag && !isClosingTag && i !== 0) {
      pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: prevSuffix() });
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
            pushPhrase({ type: phraseTypes.IDENTIFIER, suffix });
            suffix++;
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
              phrases: prevPhrase().parsedHtmlFragments,
            });
          } else if (
            isClosingTag ||
            unparsedFragment[controlCharsIndex - 1] === "/"
          ) {
            pushPhrase({ type: phraseTypes.IDENTIFIER, suffix: prevSuffix() });
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
      pushPhrase({ type: phraseTypes.IDENTIFIER, suffix });
      suffix++;

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
          suffix,
        });
        suffix++;
      }

      pushPhrase({
        type: phraseTypes.ATTRIBUTE,
        templateChildIndex: i,
        type: "attribute",
      });
    }
  });

  template.parsedHtmlFragments = mergePhrases(template.parsedHtmlFragments);
  cache[template.hash] = template.parsedHtmlFragments;
}

let currentInstanceStack = [];
let propsByKey = {};

function renderToString(key, node, result = { html: "" }) {
  currentInstanceStack.push({ key });

  const template = node._isTemplateNode ? node : node(propsByKey[key] || {});
  if (!template.parsedHtmlFragments) {
    parseTemplateInPlaceV2(template);
  }

  template.parsedHtmlFragments.forEach((phrase, i) => {
    const childKey =
      template.parsedHtmlFragments[i - 1]?.type === phraseTypes.IDENTIFIER &&
      `${
        template.parsedHtmlFragments[i - 1].prefix ||
        currentInstanceStack.at(-1).key
      } ${template.parsedHtmlFragments[i - 1].suffix.toString(32)}`;

    switch (phrase.type) {
      case phraseTypes.IDENTIFIER:
        result.html += `<!-- ${[
          phrase.prefix || currentInstanceStack.at(-1).key,
          phrase.suffix.toString(32),
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
        const templateChild =
          template.templateChildren[phrase.templateChildIndex];
        const value =
          typeof templateChild === "function" ? templateChild() : templateChild;

        if (typeof value === "number" || typeof value === "string") {
          // TODO: you also need to escape this
          result.html += value;
        } else if (typeof value === undefined || typeof value === null) {
          break;
        } else if (Array.isArray(value)) {
          if (!value.every((item) => item._isTemplateNode)) {
            throw new Error(
              "Each element in an array must be wrapped in html(key)`...`"
            );
          }

          if (!value.every((item) => item.assignedkey)) {
            throw new Error(
              "Each element in an array must have a key. Pass one like this: html(key)`...`"
            );
          }

          value.forEach((item) => {
            const itemKey = childKey + " " + item.assignedkey;
            result.html += `<!-- ${itemKey} -->`;
            renderToString(itemKey, item, result);
            result.html += `<!-- ${itemKey} -->`;
          });
        } else if (typeof value === "object" && value._isTemplateNode) {
          renderToString(childKey, value, result);
        }
        break;
      case phraseTypes.COMPONENT:
        if (
          phrase.tagName in node.components &&
          typeof node.components[phrase.tagName] === "function"
        ) {
          if (phrase.parsedHtmlFragments.length) {
            const templateChildren = [];
            phrase.parsedHtmlFragments.forEach((fragment) => {
              "templateChildIndex" in fragment
                ? (templateChildren[fragment.templateChildIndex] =
                    template.templateChildren[fragment.templateChildIndex])
                : null;
            });

            const prefixPhrases = (phrase) => {
              if (phrase.type === phraseTypes.IDENTIFIER) {
                phrase.prefix = key;
              } else if (phrase.type === phraseTypes.COMPONENT) {
                phrase.parsedHtmlFragments =
                  phrase.parsedHtmlFragments.map(prefixPhrases);
              }

              return phrase;
            };

            const children = {
              _isTemplateNode: true,
              components: node.components,
              templateChildren,
              parsedHtmlFragments:
                phrase.parsedHtmlFragments.map(prefixPhrases),
            };

            propsByKey[childKey] = { ...propsByKey[childKey], children };
          }

          renderToString(childKey, node.components[phrase.tagName], result);
        }

        break;
    }
  });

  currentInstanceStack.pop();
  return result.html;
}

const html = helix();

// DEV: the performance is looking quite good
function ArrayTest() {
  return html`
    ${new Array(3).fill(null).map((_, i) => {
      return html("key-" + i)`
        <div style=${"color: blue;"}>index: ${i}</div>
      `;
    })}
  `;
}

function Button({ children }) {
  return html`<button onClick=${() => {}}>${children}</button>`;
}

// DEV: sort of odd that it doesn't matter if you call this or not when you
// interpolate it?
function DoesThisWork() {
  return html`<span>this is an interpolated component</span>`;
}

// DEV: components can't return plain strings?
// - at least as the app root?

function WithChildren({ children }) {
  return html`
    <br />
    children:
    <div>${children}</div>
  `;
}

WithChildren.components = { Button, WithChildren, ArrayTest };

// DEV: hlx needs to be able to handle comments
const Component = () => {
  const nonce = Math.round(Math.random() * 1_000);

  const someUI = html`
    <div style=${"border: 1px dashed black;"}>this is super cool</div>
  `;

  // DEV: looks like non-interpolated children are actually being handled
  // correctly

  const evenStyle = "color: blue;";
  const oddStyle = "color: red;";

  const theEnd = "the end";

  // DEV: next thing to do is to cleanup and then handle events
  // - you could just build a dictionary of everything with an on... attr and
  //   then add a single listener and check each event?
  //   - but how would that work for things like mousemove?

  // DEV: seems like this might be the way to go
  // return html`
  //   <div>
  //     <style>
  //       @scope {
  //         & {
  //           color: green;
  //           border: 1px dashed red;
  //         }

  //         .even {
  //           color: blue;
  //         }

  //         .odd {
  //           color: red;
  //         }
  //       }
  //     </style>
  //     ${new Array(5).fill(null).map((_, i) => {
  //       return html("my-key-" + i)`
  //       <div class=${(i + 1) % 2 === 0 ? "even" : "odd"}>
  //         hello world
  //         <button>press me</button>
  //       </div>
  //     `;
  //     })}
  //     hello world
  //   </div>
  //   <div class="odd">${theEnd}</div>
  // `;

  // return html`
  //   <WithChildren>
  //     hello world
  //     <WithChildren>hello again</WithChildren>
  //   </WithChildren>
  //   <button>
  //     <span>${"press me"}</span>
  //   </button>
  // `;

  // DEV: still not quite right, something should have 0 0 1 as the identifier
  // - is there somewhere the suffix needs to be reset?
  return html`
    <WithChildren>
      hello world
      <WithChildren>
        hello again
        <WithChildren> oh no </WithChildren>
      </WithChildren>
    </WithChildren>
    <button>
      <span>press me</span>
    </button>
  `;

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

// console.log(result);

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
