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

function html(htmlStringsOrConfig, ...interpolations) {
  if (Array.isArray(htmlStringsOrConfig)) {
    const strings = htmlStringsOrConfig;
    return getTemplateBuilder(undefined, strings, ...interpolations)();
  } else if (typeof htmlStringsOrConfig === "string") {
    const key = htmlStringsOrConfig;
    return getTemplateBuilder(key);
  } else {
    const config = htmlStringsOrConfig;
    return getTemplateBuilder(config.key);
  }
}

function getTemplateBuilder(key, defaultHtmlStrings, ...defaultInterpolations) {
  return (htmlStrings, ...interpolations) => {
    const htmlStringsWithDefaults = [...(htmlStrings || defaultHtmlStrings)];

    return {
      _isTemplateNode: true,
      assignedkey: key,
      // NOTE: when determining dom changes object equality can be used instead
      // of a hash for templates created when parsing component children
      hash: htmlStringsWithDefaults.join("_"),
      interpolations: interpolations.length
        ? interpolations
        : defaultInterpolations,
      htmlStrings: htmlStringsWithDefaults,
      parsedHtmlPhrases: [],
      identifiers: [],
      slots: [],
      attributes: [],
      listeners: [],
      children: [],
    };
  };
}

// TODO: more work here and in a renderToString to make sure components are
// passed around properly
function parseTemplateInPlace(template) {
  let isOpeningTag = false;
  let isClosingTag = false;
  let isComponentTag = false;
  let isAttr = false;

  const templateStack = [template];

  function prevPhrase() {
    return templateStack.at(-1).parsedHtmlPhrases.at(-1);
  }

  function pushPhrase(phrase) {
    templateStack.at(-1).parsedHtmlPhrases.push(phrase);
  }

  function getIdentifiers() {
    return templateStack.at(-1).identifiers;
  }

  template.htmlStrings.forEach((fragment, i) => {
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
            getIdentifiers().push(Symbol());
            pushPhrase({
              type: phraseTypes.IDENTIFIER,
              index: getIdentifiers().length - 1,
            });
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
            templateStack.at(-1).parsedHtmlPhrases = mergePhrases(
              templateStack.at(-1).parsedHtmlPhrases,
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
            templateStack.at(-1).children.push({
              _isTemplateNode: true,
              interpolations: templateStack.at(-1).interpolations,
              parsedHtmlPhrases: [],
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
              index: getIdentifiers().length - 1,
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
      i !== template.htmlStrings.length - 1
    ) {
      getIdentifiers().push(Symbol());
      pushPhrase({
        type: phraseTypes.IDENTIFIER,
        index: getIdentifiers().length - 1,
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
      const phrases = templateStack.at(-1).parsedHtmlPhrases;
      const tagStart = phrases.findLastIndex((phrase) => phrase.tagStart);

      if (
        !phrases[tagStart - 1] ||
        phrases[tagStart - 1].type !== phraseTypes.IDENTIFIER
      ) {
        getIdentifiers().push(Symbol());
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

  template.parsedHtmlPhrases = mergePhrases(template.parsedHtmlPhrases);
}

let propsByKey = {};

function renderToString(key, node, result = { html: "", listeners: {} }) {
  // DEV: this should handle primitive values
  const template = node._isTemplateNode ? node : node(propsByKey[key] || {});
  if (!template.parsedHtmlPhrases.length) {
    parseTemplateInPlace(template);
  }

  let suffix = 0;
  const keysByIdentifier = {};

  console.log(JSON.stringify(template, null, 2));

  template.parsedHtmlPhrases.forEach((phrase, i) => {
    const prevPhrase = template.parsedHtmlPhrases[i - 1];

    const activeKey =
      prevPhrase?.type === phraseTypes.IDENTIFIER &&
      keysByIdentifier[template.identifiers[prevPhrase.index]];

    switch (phrase.type) {
      case phraseTypes.IDENTIFIER: {
        const identifier = template.identifiers[phrase.index];
        const identiferKey = (keysByIdentifier[identifier] ||=
          key + " " + suffix++);
        result.html += `<!-- ${identiferKey} -->`;
        break;
      }
      case phraseTypes.HTML:
        result.html += phrase.value;
        break;
      case phraseTypes.ATTRIBUTE:
        result.html += `"${
          // TODO: you may need to escape this
          template.interpolations[
            template.attributes[phrase.index].templateChildIndex
          ]
        }"`;
        break;
      case phraseTypes.SLOT: {
        const templateChild =
          template.interpolations[
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
            const itemKey = activeKey + " " + item.assignedkey;
            result.html += `<!-- ${itemKey} -->`;
            renderToString(itemKey, item, result);
            result.html += `<!-- ${itemKey} -->`;
          });
        } else if (typeof value === "object" && value._isTemplateNode) {
          renderToString(activeKey, value, result);
        }
        break;
      }
      case phraseTypes.COMPONENT:
        if (
          phrase.tagName in node.components &&
          typeof node.components[phrase.tagName] === "function"
        ) {
          if ("childrenIndex" in phrase) {
            const children = template.children[phrase.childrenIndex];

            propsByKey[activeKey] = {
              ...propsByKey[activeKey],
              children: {
                ...children,
                components: children.components || node.components,
              },
            };
          }

          renderToString(activeKey, node.components[phrase.tagName], result);
        } else {
          throw new Error(`Component "${phrase.tagName}" not found`);
        }

        break;
    }
  });

  return result;
}

// DEV: components can't return plain strings?
// - at least as the app root?

function Primitive() {
  return html`<div>this is a primitive</div>`;
}

function WithChildren({ children }) {
  return html`
    <br />
    children:
    <div onKeyDown=${() => {}}>${children}</div>
  `;
}

WithChildren.components = { WithChildren, Primitive };

const App = () => {
  // return html`
  //   <div>
  //     ${new Array(3).fill(null).map(
  //       (_, i) => html("my-key-" + i)`
  //       <div>
  //         hello world
  //         <button onClick=${() => {}}>press me</button>
  //       </div>
  //     `,
  //     )}
  //   </div>
  // `;

  return html`
    <Primitive />
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
};

App.components = { WithChildren, Primitive };

const result = renderToString("root", App);
const root = document.getElementById("root");

root.innerHTML = result.html;
