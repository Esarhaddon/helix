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

// DEV: children will need to be excluded from the cache sometimes?
// - or the hash calculation will just be a little tricky?
// - everytime you push a phrase, you should also add to a shared hash?
// - don't think you're thinking about this quite right
// - actaully, I think you can calculate the hash when you merge phrases?

// DEV: keys need to be based on where things end up in the dom
// - your idea that keys should be based on where children were defined was
//   wrong. In order for rendering to be consistent the key associated with a
//   slot can't change, and therefore has to be determined by it's position

// DEV: keys are still not working quite right
// - identifiers

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

function html(stringsOrConfig, ...children) {
  if (Array.isArray(stringsOrConfig)) {
    const strings = stringsOrConfig;
    return getTemplateBuilder(undefined, strings, ...children)();
  } else if (typeof stringsOrConfig === "string") {
    const key = stringsOrConfig;
    return getTemplateBuilder(key);
  } else {
    const config = stringsOrConfig;
    return getTemplateBuilder(config.key);
  }
}

function getTemplateBuilder(key, defaultStrings, ...defaultChildren) {
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
      // DEV: this should be called something else
      templateChildren: children.length ? children : defaultChildren,
      identifiers: [],
      slots: [],
      attributes: [],
      listeners: [],
      children: [],
    };
  };
}

// TODO: one layer of indirection between the actual event listeners and the
// interpolated functions would allow listeners to be attached before all the JS
// had loaded
// - what about serializing event listeners in the dom?

function parseTemplateInPlace(template) {
  let isOpeningTag = false;
  let isClosingTag = false;
  let isComponentTag = false;
  let isAttr = false;

  const result = [];
  template.parsedHtmlFragments = result;

  let suffix = 0;
  const templateStack = [template];

  function prevPhrase() {
    return templateStack.at(-1).parsedHtmlFragments.at(-1);
  }

  function pushPhrase(phrase) {
    templateStack.at(-1).parsedHtmlFragments.push(phrase);
  }

  function getIdentifiers() {
    return templateStack.at(-1).identifiers;
  }

  template.htmlFragments.forEach((fragment, i) => {
    // Add a closing identifier for slots
    if (!isOpeningTag && !isClosingTag && i !== 0) {
      pushPhrase({
        type: phraseTypes.IDENTIFIER,
        index: getIdentifiers().length - 1,
      });
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
          (templateStack.length > 1 &&
            !isOpeningTag &&
            !isAttr &&
            char === "<" &&
            unparsedFragment[i + 1] === "/") ||
          // Tag end
          (((isOpeningTag && !isAttr) || isClosingTag) && char === ">"),
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
            templateStack.at(-1).identifiers.push({ suffix });
            pushPhrase({
              type: phraseTypes.IDENTIFIER,
              index: templateStack.at(-1).identifiers.length - 1,
            });
            suffix++;
          }

          // DEV: this is an odd way of doing things
          pushPhrase({ type: phraseTypes.HTML, tagStart: true, value: "<" });

          if (isComponentTag) {
            Object.assign(prevPhrase(), {
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
                    .findIndex((char) => !/[a-z0-9]/i.test(char)),
              ),
              isOpeningTag: true,
              value: "",
              childrenIndex: templateStack.at(-1).children.length - 1,
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
            // Handle non-interpolated component attributes

            const name = unparsedFragment.slice(
              unparsedFragment
                .slice(0, controlCharsIndex - 1)
                .lastIndexOf(" ") + 1,
              controlCharsIndex - 1,
            );

            const value = unparsedFragment.slice(
              controlCharsIndex + 1,
              controlCharsIndex +
                1 +
                unparsedFragment.slice(controlCharsIndex + 1).indexOf('"'),
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
              isComponentTag ? controlCharsIndex : controlCharsIndex + 2,
            ),
          });

          if (isComponentTag) {
            templateStack.at(-1).parsedHtmlFragments = mergePhrases(
              templateStack.at(-1).parsedHtmlFragments,
            );
            templateStack.pop();
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
            // DEV: you're going to need to compute the hash later
            // - also, should be able to get rid of the .parent indirection
            templateStack.at(-1).children.push({
              _isTemplateNode: true,
              templateChildren: templateStack.at(-1).templateChildren,
              parsedHtmlFragments: [],
              children: [],
              identifiers: [],
              attributes: [],
              listeners: [],
              slots: [],
            });

            prevPhrase().childrenIndex =
              templateStack.at(-1).children.length - 1;

            templateStack.push(templateStack.at(-1).children.at(-1));
          } else if (
            isClosingTag ||
            unparsedFragment[controlCharsIndex - 1] === "/"
          ) {
            pushPhrase({
              type: phraseTypes.IDENTIFIER,
              index: templateStack.at(-1).identifiers.length - 1,
            });
          }

          isClosingTag = false;
          isOpeningTag = false;
          isComponentTag = false;

          break;
      }

      unparsedFragment = controlChars
        ? unparsedFragment.slice(controlCharsIndex + controlChars.length)
        : "";

      // Handle component props and interpolated component attributes
      if (
        !unparsedFragment &&
        isComponentTag &&
        isOpeningTag &&
        prevPhrase().type === phraseTypes.COMPONENT
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

    // Handle slots, non-component attributes, and inline event listeners
    if (
      !isOpeningTag &&
      !isClosingTag &&
      i !== template.htmlFragments.length - 1
    ) {
      templateStack.at(-1).identifiers.push({ suffix });
      suffix++;
      pushPhrase({
        type: phraseTypes.IDENTIFIER,
        index: templateStack.at(-1).identifiers.length - 1,
      });

      templateStack.at(-1).slots.push({
        templateChildIndex: i,
        identifierIndex: getIdentifiers().length - 1,
      });
      pushPhrase({
        type: phraseTypes.SLOT,
        index: templateStack.at(-1).slots.length - 1,
        type: "slot",
      });
    } else if (isOpeningTag && !isComponentTag) {
      const phrases = templateStack.at(-1).parsedHtmlFragments;
      const tagStart = phrases.findLastIndex((phrase) => phrase.tagStart);

      if (
        !phrases[tagStart - 1] ||
        phrases[tagStart - 1].type !== phraseTypes.IDENTIFIER
      ) {
        getIdentifiers().push({ suffix });
        suffix++;
        phrases.splice(tagStart, 0, {
          type: phraseTypes.IDENTIFIER,
          index: getIdentifiers().length - 1,
        });
      }

      const attrStart =
        prevPhrase()
          .value.split("")
          .findLastIndex((char) => char === " ") + 1;
      const attrName = prevPhrase().value.slice(attrStart, -1);

      if (attrName.startsWith("on")) {
        // Strip out inline event listeners so they can be attached later
        prevPhrase().value = prevPhrase()
          .value.split("")
          .toSpliced(attrStart, attrName.length + 1)
          .join("");

        templateStack.at(-1).listeners.push({
          templateChildIndex: i,
          event: attrName.slice(2).toLowerCase(),
          identifierIndex: getIdentifiers().length - 1,
        });
      } else {
        templateStack.at(-1).attributes.push({
          templateChildIndex: i,
          identifierIndex: getIdentifiers().length - 1,
        });
        pushPhrase({
          type: phraseTypes.ATTRIBUTE,
          index: templateStack.at(-1).attributes.length - 1,
          type: "attribute",
        });
      }
    }
  });

  template.parsedHtmlFragments = mergePhrases(template.parsedHtmlFragments);
}

let propsByKey = {};

function renderToString(key, node, result = { html: "", listeners: {} }) {
  // DEV: this should handle primitive values
  const template = node._isTemplateNode ? node : node(propsByKey[key] || {});
  if (!template.parsedHtmlFragments) {
    parseTemplateInPlace(template);
  }

  console.log(JSON.stringify(template, null, 2));

  template.parsedHtmlFragments.forEach((phrase, i) => {
    const prevPhrase = template.parsedHtmlFragments[i - 1];
    const childKey =
      prevPhrase?.type === phraseTypes.IDENTIFIER &&
      `${
        template.identifiers[prevPhrase.index].prefix || key
      } ${template.identifiers[prevPhrase.index].suffix.toString(32)}`;

    switch (phrase.type) {
      case phraseTypes.IDENTIFIER:
        const identifier = [
          template.identifiers[phrase.index].prefix || key,
          template.identifiers[phrase.index].suffix.toString(32),
        ].join(" ");

        result.html += `<!-- ${identifier} -->`;
        break;
      case phraseTypes.HTML:
        result.html += phrase.value;
        break;
      case phraseTypes.ATTRIBUTE:
        result.html += `"${
          // TODO: you may need to escape this
          template.templateChildren[
            template.attributes[phrase.index].templateChildIndex
          ]
        }"`;
        break;
      case phraseTypes.SLOT:
        const templateChild =
          template.templateChildren[
            template.slots[phrase.index].templateChildIndex
          ];
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
              "Each element in an array must be wrapped in html(key)`...`",
            );
          }

          if (!value.every((item) => item.assignedkey)) {
            throw new Error(
              "Each element in an array must have a key. Pass one like this: html(key)`...`",
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
          // DEV: should probably throw an error if we can't find the component
          phrase.tagName in node.components &&
          typeof node.components[phrase.tagName] === "function"
        ) {
          if ("childrenIndex" in phrase) {
            const children = template.children[phrase.childrenIndex];

            // TODO: might be some extra work to make this work with a cache
            const prefixIdentifiers = (template) => {
              template.identifiers.forEach((identifier) => {
                identifier.prefix = identifier.prefix || key;
              });
              template.children.forEach(prefixIdentifiers);
              return template;
            };

            propsByKey[childKey] = {
              ...propsByKey[childKey],

              // DEV: pretty sure you need to do away with this?
              // children: prefixIdentifiers({
              //   ...children,
              //   components: node.components,
              // }),
              children: {
                ...children,
                components: node.components,
              },
            };
          }

          renderToString(childKey, node.components[phrase.tagName], result);
        }

        break;
    }
  });

  return result;
}

const nodes = {};

function render(node, key) {
  let template;

  if (node._isTemplateNode) {
    template = node;
  } else if (typeof node === "function") {
    template = node(propsByKey[key] || {});
  } else {
    throw new Error("[render] Encountered invalid node", { cause: node });
  }

  if (!template.parsedHtmlFragments) {
    parseTemplateInPlace(template);
  }

  // DEV: what is the proper way to handle slots?
  if (nodes[key] && nodes[key].hash === template.hash) {
    // no need to render to string
    // - handle attributes
    // - handle slots
    //   - you may need to recursiveley call render to handle slots?
    //   - how to properly handle nested slots?
  } else {
    // Clear unmounted nodes from the cache
    if (nodes[key]) {
      Object.keys(nodes).forEach((item) => {
        // DEV: you're also going to need to clean up event listeners
        if (item.startsWith(key)) {
          delete nodes[item];
        }
      });
    }

    // we need to render to string and update the dom
  }
}

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
    <div onKeyDown=${() => {}}>${children}</div>
  `;
}

WithChildren.components = { Button, WithChildren, ArrayTest };

const Component = () => {
  const nonce = Math.round(Math.random() * 1_000);

  const someUI = html`
    <div style=${"border: 1px dashed black;"}>this is super cool</div>
  `;

  const evenStyle = "border: 1px dashed gray; width: fit-content;";
  const oddStyle = "border: 1px solid black; width: fit-content;";

  const theEnd = "the end";

  // return html`
  //   <div>
  //     ${new Array(3).fill(null).map(
  //       (_, i) => html("my-key-" + i)`
  //       <div>
  //         hello world
  //         <button onClick=${() => {}}>press me</button>
  //       </div>
  //     `
  //     )}
  //   </div>
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

  // DEV: not sure that slots are indexed quite right
  // - also, you need to properly pass components to slots
  //   - should this happen during parsing?
  //   - not quite sure how to determine where we should look for components for
  //     a particular slot
  return html`
    hi there
    <div id=${"attr-value"} onClick=${() => {}}>attr test</div>
    <WithChildren>
      ${html`<span>
        this is a slot ${html`<div>and this is a nested slot</div>`}
      </span>`}
      hello world
      <div class=${"my-div"} onMouseMove=${() => {}}>how about here</div>
      <WithChildren>
        hello again
        <WithChildren>it's working!</WithChildren>
      </WithChildren>
    </WithChildren>
    <button onClick=${() => {}}>
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

root.innerHTML = result.html;

/*

<script type="module">
  import { createRoot } from "helix"
  import * as tree from "./app.js"

  const root = createRoot(document.getElementById("root"), tree)
  root.render(tree.App)
</script>

*/
