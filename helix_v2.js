const phraseTypes = {
  IDENTIFIER: "identifier",
  ATTRIBUTE: "attribute",
  HTML: "html",
  SLOT: "slot",
  COMPONENT: "component",
};

function isPrimitive(value) {
  return (
    value === null ||
    typeof value === "undefined" ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  );
}

function isMergeable(phrase) {
  return phrase && phrase.type === phraseTypes.HTML;
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
      props: [],
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
        // Handle tag start
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

          if (isComponentTag) {
            pushPhrase({
              type: phraseTypes.COMPONENT,
              tagStart: true,
              value: "<",
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
          } else {
            pushPhrase({ type: phraseTypes.HTML, tagStart: true, value: "<" });
          }

          isOpeningTag = true;

          break;
        // Handle non-interpolated attribute start/end
        case '"':
          if (!isComponentTag) {
            pushPhrase({
              type: phraseTypes.HTML,
              value: unparsedFragment.slice(0, controlCharsIndex + 1),
            });
          } else if (!isAttr) {
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

            templateStack.at(-1).props.push({
              identifierIndex: getIdentifiers().length - 1,
              name,
              value,
            });
          }

          isAttr = !isAttr;

          break;
        // Handle closing tag start
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
        // Handle tag end
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
            templateStack.at(-1).props.push({
              identifierIndex: getIdentifiers().length - 1,
              name: "children",
              value: {
                _isTemplateNode: true,
                interpolations: templateStack.at(-1).interpolations,
                parsedHtmlPhrases: [],
                identifiers: [],
                attributes: [],
                listeners: [],
                slots: [],
                props: [],
              },
            });

            templateStack.push(templateStack.at(-1).props.at(-1).value);
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
        prevPhrase().type === phraseTypes.COMPONENT &&
        fragment.endsWith("=")
      ) {
        templateStack.at(-1).props.push({
          identifierIndex: getIdentifiers().length - 1,
          name: fragment.slice(fragment.lastIndexOf(" ") + 1, -1),
          interpolationIndex: i,
        });
      }
    }

    // Handle slots, interpolated non-component attributes, and inline event
    // listeners
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
        interpolationIndex: i,
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

      // Strip out inline event listeners so they can be attached later
      if (attrName.startsWith("on")) {
        prevPhrase().value = prevPhrase()
          .value.split("")
          .toSpliced(attrStart, attrName.length + 1)
          .join("");

        templateStack.at(-1).listeners.push({
          interpolationIndex: i,
          event: attrName.slice(2).toLowerCase(),
          identifierIndex: getIdentifiers().length - 1,
        });
      } else {
        templateStack.at(-1).attributes.push({
          interpolationIndex: i,
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
  const template = node._isTemplateNode ? node : node(propsByKey[key] || {});

  if (isPrimitive(template)) {
    // TODO: primitives need to be escaped at some point
    if (typeof template === "string" || typeof template === "number") {
      result.html += template;
    }

    return result;
  }

  if (!template.parsedHtmlPhrases.length) {
    parseTemplateInPlace(template);
  }

  let suffix = 0;
  const keysByIdentifier = {};

  template.parsedHtmlPhrases.forEach((phrase, i) => {
    const prevPhrase = template.parsedHtmlPhrases[i - 1];
    const activeKey =
      prevPhrase?.type === phraseTypes.IDENTIFIER &&
      keysByIdentifier[template.identifiers[prevPhrase.index]];

    switch (phrase.type) {
      case phraseTypes.IDENTIFIER:
        {
          const identifier = template.identifiers[phrase.index];
          const identiferKey = (keysByIdentifier[identifier] ||=
            key + " " + suffix++);
          result.html += `<!-- ${identiferKey} -->`;
        }
        break;
      case phraseTypes.HTML:
        result.html += phrase.value;
        break;
      case phraseTypes.ATTRIBUTE:
        {
          const attribute = template.attributes[phrase.index];
          result.html += `"${
            // TODO: you may need to escape this
            template.interpolations[attribute.interpolationIndex]
          }"`;
        }
        break;
      case phraseTypes.SLOT:
        {
          const interpolation =
            template.interpolations[
              template.slots[phrase.index].interpolationIndex
            ];
          const value =
            typeof interpolation === "function"
              ? interpolation()
              : interpolation;

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
        }
        break;
      case phraseTypes.COMPONENT:
        if (
          phrase.tagName in node.components &&
          typeof node.components[phrase.tagName] === "function"
        ) {
          propsByKey[activeKey] = Object.fromEntries(
            template.props.flatMap((prop) =>
              template.identifiers[prop.identifierIndex] ===
              template.identifiers[prevPhrase.index]
                ? [
                    [
                      prop.name,
                      prop.name === "children"
                        ? {
                            ...prop.value,
                            components:
                              prop.value.components || node.components,
                          }
                        : prop.value ||
                          template.interpolations[prop.interpolationIndex],
                    ],
                  ]
                : [],
            ),
          );

          renderToString(activeKey, node.components[phrase.tagName], result);
        } else {
          throw new Error(`Component "${phrase.tagName}" not found`);
        }
        break;
    }
  });

  return result;
}

function WithChildren({ children }) {
  return html`
    <br />
    children:
    <div onKeyDown=${() => {}}>${children}</div>
  `;
}

function OtherPropsTest({ id, class: className, children }) {
  return html`<div id=${id} class=${className}>${children}</div> `;
}

WithChildren.components = { WithChildren, OtherPropsTest };

function Heading({ children }) {
  return html`<h1>${children}</h1> `;
}

const App = () => {
  // return html`<Heading>hello world</Heading>`;

  return html`
    hi there
    <div id=${"attr-value"} onClick=${() => {}}>attr test</div>
    <OtherPropsTest id="my-test-component" class="h-small w-medium">
      pretty sure this is working
    </OtherPropsTest>
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

App.components = { Heading, WithChildren, OtherPropsTest };

const result = renderToString("root", App);
const root = document.getElementById("root");

root.innerHTML = result.html;
