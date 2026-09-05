const phraseTypes = {
  IDENTIFIER: "identifier",
  ATTRIBUTE: "attribute",
  HTML: "html",
  SLOT: "slot",
  COMPONENT: "component",
};

const INVALID_ARRAY_ITEM =
  "[Aspen] Each item in an array must be a template. Create one like this: html(key)`...`";
const MISSING_ARRAY_ITEM_KEY =
  "[Aspen] Each template in an array must have a key. Pass one like this: html(key)`...`";

const DEBUG = true;

function debug(...msg) {
  DEBUG && console.log(...msg);
}

function isValidKey(key) {
  return (
    typeof key === "symbol" ||
    (typeof key === "string" && key.trim()) ||
    (typeof key === "number" && !isNaN(key))
  );
}

function isTemplate(value) {
  return value && value._isTemplateNode;
}

function isTemplateMatch(a, b) {
  if (!a.hash && !b.hash) {
    return a === b;
  }
  return a.hash === b.hash;
}

function isInterpolationsMatch(a, b) {
  return (
    a.interpolations.length === b.interpolations.length &&
    a.interpolations.every(
      (value, i) => isPrimitive(value) && b.interpolations[i] === value,
    )
  );
}

function isPrimitive(value) {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  );
}

function isRenderablePrimitive(value) {
  return typeof value === "string" || typeof value === "number";
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * Intentionally counts "" as truthy since that is used to indicate an
 * attribute value of true in html
 */
function isHtmlTruthy(value) {
  if (value === false || value === undefined || value === null) {
    return false;
  }
  return true;
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

function resolveComponents(module) {
  const templates = [];
  const components = {};

  Object.entries(module).forEach(([name, value]) => {
    if (isTemplate(value)) {
      templates.push(value);
    } else if (typeof value === "function" && /[A-Z]/.test(name)) {
      components[name] = value;
    } else if (
      /[A-Z]/.test(name) &&
      value &&
      typeof value === "object" &&
      value[Symbol.toStringTag] === "Module" &&
      typeof value[name] === "function"
    ) {
      components[name] = value[name];
      components[name].components = resolveComponents(value);
    }
  });

  // TODO: re-exported templates may end up with the wrong components
  templates.forEach((template) => (template.components = components));
  Object.values(components).forEach(
    (component) => (component.components ||= components),
  );

  return components;
}

export function createRoot(domNode, scope) {
  const components = resolveComponents(scope);

  return {
    render(template) {
      template.components = components;

      const result = renderToString("root", template);
      domNode.innerHTML = result.html;

      hydrate("root", result);

      while (deferredTasks.length) {
        deferredTasks.shift()();
      }
    },
  };
}

const codeLookup = {
  "&": "&amp;",
  "<": "&lt;",
  '"': "&quot;",
  "'": "&#39;",
  ">": "&gt;",
};

function escapeHtml(text) {
  if (typeof text !== "string") {
    return text;
  }

  return text.replace(/&|<|"|'|>/g, (match) => codeLookup[match]);
}

export function html(htmlStringsOrConfig, ...interpolations) {
  if (Array.isArray(htmlStringsOrConfig)) {
    const strings = htmlStringsOrConfig;
    return getTemplateBuilder(undefined, strings, ...interpolations)();
  } else if (isValidKey(htmlStringsOrConfig)) {
    const key = htmlStringsOrConfig;
    return getTemplateBuilder(key);
  } else {
    const config = htmlStringsOrConfig;
    return getTemplateBuilder(config.key);
  }
}

// TODO: figure out how to make templates cacheable
function getTemplateBuilder(key, defaultHtmlStrings, ...defaultInterpolations) {
  return (htmlStrings, ...interpolations) => {
    const htmlStringsWithDefaults = [...(htmlStrings || defaultHtmlStrings)];

    return {
      _isTemplateNode: true,
      assignedKey: isValidKey(key) ? key : undefined,
      // NOTE: when determining dom changes, object equality can be used
      // instead of a hash for templates created when parsing component
      // children
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

// TODO: trim inter-element whitespace

function parseTemplateInPlace(template) {
  let isOpeningTag = false;
  let isClosingTag = false;
  let isComponentTag = false;
  let isAttr = false;
  let suffix = 0;

  const templateStack = [template];

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
      const specialCharsIndex = unparsedFragment.split("").findIndex(
        (char, i) =>
          // Opening tag start
          (!isOpeningTag &&
            !isAttr &&
            char === "<" &&
            unparsedFragment[i + 1] !== "/") ||
          // Attribute start or end
          (isOpeningTag && char === '"') ||
          // Closing tag start
          (templateStack.length > 1 &&
            !isOpeningTag &&
            !isAttr &&
            char === "<" &&
            unparsedFragment[i + 1] === "/") ||
          // Tag end
          (((isOpeningTag && !isAttr) || isClosingTag) && char === ">"),
      );

      const specialChars =
        specialCharsIndex < 0
          ? undefined
          : unparsedFragment[specialCharsIndex] === "<" &&
              unparsedFragment[specialCharsIndex + 1] === "/"
            ? "</"
            : unparsedFragment[specialCharsIndex];

      if (!specialChars) {
        break;
      }

      switch (specialChars) {
        // Handle tag start
        case "<":
          if (specialCharsIndex !== 0) {
            pushPhrase({
              type: phraseTypes.HTML,
              value: unparsedFragment.slice(0, specialCharsIndex),
            });
          }

          if (/[A-Z]/.test(unparsedFragment[specialCharsIndex + 1])) {
            isComponentTag = true;
            getIdentifiers().push({ suffix });
            suffix++;

            pushPhrase({
              type: phraseTypes.IDENTIFIER,
              index: getIdentifiers().length - 1,
            });

            pushPhrase({
              type: phraseTypes.COMPONENT,
              tagStart: true,
              tagName: unparsedFragment.slice(
                specialCharsIndex + 1,
                specialCharsIndex +
                  1 +
                  unparsedFragment
                    .slice(specialCharsIndex + 1)
                    .split("")
                    // TODO: figure out what characters should be allowed in
                    // component names
                    .findIndex((char) => !/[a-z0-9]/i.test(char)),
              ),
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
              value: unparsedFragment.slice(0, specialCharsIndex + 1),
            });
          } else if (!isAttr) {
            const name = unparsedFragment.slice(
              unparsedFragment
                .slice(0, specialCharsIndex - 1)
                .lastIndexOf(" ") + 1,
              specialCharsIndex - 1,
            );

            const value = unparsedFragment.slice(
              specialCharsIndex + 1,
              specialCharsIndex +
                1 +
                unparsedFragment.slice(specialCharsIndex + 1).indexOf('"'),
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
          if (/[A-Z]/.test(unparsedFragment[specialCharsIndex + 2])) {
            isComponentTag = true;
          }

          pushPhrase({
            type: phraseTypes.HTML,
            value: unparsedFragment.slice(
              0,
              isComponentTag ? specialCharsIndex : specialCharsIndex + 2,
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
            // TODO: handle self closing tags
            pushPhrase({
              type: phraseTypes.HTML,
              value: unparsedFragment.slice(0, specialCharsIndex + 1),
            });
          } else if (
            isOpeningTag &&
            unparsedFragment[specialCharsIndex - 1] !== "/"
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
                components: template.components,
              },
            });

            templateStack.push(templateStack.at(-1).props.at(-1).value);
          } else if (
            isClosingTag ||
            unparsedFragment[specialCharsIndex - 1] === "/"
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

      unparsedFragment = unparsedFragment.slice(
        specialCharsIndex + specialChars.length,
      );
    }

    // Handle interpolated component props
    if (isComponentTag && isOpeningTag && fragment.endsWith("=")) {
      templateStack.at(-1).props.push({
        identifierIndex: getIdentifiers().length - 1,
        name: fragment.slice(fragment.lastIndexOf(" ") + 1, -1),
        interpolationIndex: i,
      });
    }
    // Handle interpolated attributes and inline event listeners
    else if (
      isOpeningTag &&
      !isComponentTag &&
      unparsedFragment.endsWith("=")
    ) {
      const phrases = templateStack.at(-1).parsedHtmlPhrases;
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

      const attrStart = unparsedFragment.lastIndexOf(" ") + 1;
      const attrName = unparsedFragment.slice(attrStart, -1);

      pushPhrase({
        type: phraseTypes.HTML,
        value: unparsedFragment.slice(0, attrStart),
      });

      if (attrName.startsWith("on")) {
        getIdentifiers().at(-1).hasEvent = true;

        templateStack.at(-1).listeners.push({
          interpolationIndex: i,
          event: attrName.slice(2).toLowerCase(),
          identifierIndex: getIdentifiers().length - 1,
        });
      } else {
        templateStack.at(-1).attributes.push({
          name: attrName,
          interpolationIndex: i,
          identifierIndex: getIdentifiers().length - 1,
        });

        pushPhrase({
          type: phraseTypes.ATTRIBUTE,
          index: templateStack.at(-1).attributes.length - 1,
        });
      }
    }
    // Handle slots
    else if (
      !isOpeningTag &&
      !isClosingTag &&
      i !== template.htmlStrings.length - 1
    ) {
      pushPhrase({ type: phraseTypes.HTML, value: unparsedFragment });

      getIdentifiers().push({ suffix });
      suffix++;

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
      });
    } else {
      pushPhrase({ type: phraseTypes.HTML, value: unparsedFragment });
    }
  });

  template.parsedHtmlPhrases = mergePhrases(template.parsedHtmlPhrases);
}

const renderStack = [];

const templatesByKey = {};
const componentsByKey = {};

let propsByKey = {};

function renderToString(key, node, result = { html: "", listenersByKey: {} }) {
  let template;
  if (isTemplate(node)) {
    template = node;
  } else {
    componentsByKey[key] = node;

    renderStack.push({
      type: "component",
      key,
      onUpdate: () => render(key, node),
    });

    const props = resolveSignalProps(propsByKey[key] || {});

    componentHookIndex = 0;
    template = node(props);
    componentHookIndex = 0;

    renderStack.pop();
  }

  if (isPrimitive(template)) {
    if (isRenderablePrimitive(template)) {
      result.html += escapeHtml(template);
    }

    return result;
  }

  template.components ||= node.components;

  if (!template.parsedHtmlPhrases.length) {
    parseTemplateInPlace(template);
  }

  templatesByKey[key] = template;

  template.parsedHtmlPhrases.forEach((phrase, i) => {
    const prevPhrase = template.parsedHtmlPhrases[i - 1];
    const activeKey =
      prevPhrase?.type === phraseTypes.IDENTIFIER &&
      key + "." + template.identifiers[prevPhrase.index].suffix;

    switch (phrase.type) {
      case phraseTypes.IDENTIFIER:
        {
          const identifier = template.identifiers[phrase.index];

          result.html += `<!-- ${identifier.hasEvent ? "evt " : ""}${
            key + "." + identifier.suffix
          } -->`;
        }
        break;
      case phraseTypes.HTML:
        result.html += phrase.value;
        break;
      case phraseTypes.ATTRIBUTE:
        {
          const attribute = template.attributes[phrase.index];
          const value = template.interpolations[attribute.interpolationIndex];

          if (value === true) {
            // Including only the name is the proper way to indicate an
            // attribute value of true in html
            result.html += attribute.name;
          } else if (
            isHtmlTruthy(value) &&
            // Don't include inline event listeners as those are attached with
            // addEventListener
            !attribute.name.startsWith("on")
          ) {
            result.html += `${attribute.name}="${escapeHtml(value)}"`;
          }
        }
        break;
      case phraseTypes.SLOT:
        {
          const value =
            template.interpolations[
              template.slots[phrase.index].interpolationIndex
            ];

          if (isPrimitive(value)) {
            if (isRenderablePrimitive(value)) {
              result.html += escapeHtml(value);
            }
          } else if (isTemplate(value)) {
            value.components ||= template.components;

            renderToString(activeKey, value, result);
          } else if (Array.isArray(value)) {
            if (!value.every(isTemplate)) {
              throw new Error(INVALID_ARRAY_ITEM);
            }

            if (!value.every((item) => isValidKey(item.assignedKey))) {
              throw new Error(MISSING_ARRAY_ITEM_KEY);
            }

            value.forEach((item) => {
              const itemKey = getArrayItemKey(activeKey, item.assignedKey);

              item.components ||= template.components;

              result.html += `<!-- ${itemKey} -->`;
              renderToString(itemKey, item, result);
              result.html += `<!-- ${itemKey} -->`;
            });
          }
        }
        break;
      case phraseTypes.COMPONENT:
        if (
          phrase.tagName in template.components &&
          typeof template.components[phrase.tagName] === "function"
        ) {
          propsByKey[activeKey] = Object.fromEntries(
            template.props.flatMap((prop) =>
              template.identifiers[prop.identifierIndex] ===
              template.identifiers[prevPhrase.index]
                ? [
                    [
                      prop.name,
                      prop.name === "children" && isTemplate(prop.value)
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

          renderToString(
            activeKey,
            template.components[phrase.tagName],
            result,
          );
        } else {
          throw new Error(`[Aspen] Component "${phrase.tagName}" not found`);
        }
        break;
    }
  });

  // Keep track of listeners so they can be attached after the dom is updated
  template.listeners.forEach((listener) => {
    const listenerKey =
      key + "." + template.identifiers[listener.identifierIndex].suffix;

    result.listenersByKey[listenerKey] ||= [];
    result.listenersByKey[listenerKey].push({
      event: listener.event,
      handler: template.interpolations[listener.interpolationIndex],
    });
  });

  return result;
}

const elementsByKey = {};

function getElementByKey(key) {
  const el = (elementsByKey[key] ||= document.evaluate(
    `//comment()[contains(string(), " ${key} ")]`,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
  ).singleNodeValue?.nextSibling);

  if (!el.isConnected) {
    throw new Error("[Aspen] Encountered disconnected element");
  }

  return el;
}

// TODO: Try event delegation
// - might be more memory efficient since you wouldn't have so many listeners
// - you wouldn't need document.evaluate at all (for attaching events)
//   - that would actually be a big perf win in some scenarios
function hydrate(rootKey, { listenersByKey }) {
  const nodeSet = document.evaluate(
    `//comment()[contains(string(), " evt ${rootKey}")]`,
    document,
    null,
    XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
  );

  let node;
  while ((node = nodeSet.iterateNext())) {
    const [, key] = node.nodeValue.trim().split(" ");
    const listeners = listenersByKey[key];
    const element = node.nextSibling;

    // TODO: Why is listeners sometimes undefined?
    listeners?.forEach(({ event, handler }) =>
      element.addEventListener(event, handler),
    );
  }
}

/**
 * - "set" replaces html between two keys,
 * - "text" does the same thing for a text node
 * - "overwrite" is like set but it writes over the matching start and end keys
 *   as well
 * - "append" inserts html after the second matching key
 * - "insert" inserts html after the first matching key without replacing
 *   anything
 *
 * @param {"set" | "text" | "overwrite" | "append" | "insert"} [mode="set"]
 */
function setHtml(key, html, mode = "set") {
  debug("Setting html with mode", mode);

  let result = document.evaluate(
    `//comment()[contains(string(), " ${key} ")]`,
    document,
    null,
    mode === "append"
      ? XPathResult.ORDERED_NODE_ITERATOR_TYPE
      : XPathResult.FIRST_ORDERED_NODE_TYPE,
  );

  const node =
    mode === "append"
      ? result.iterateNext() && result.iterateNext()
      : result.singleNodeValue;

  if (mode === "set" || mode === "text" || mode === "overwrite") {
    while (
      node.nextSibling &&
      !(
        node.nextSibling.nodeType === Node.COMMENT_NODE &&
        node.nextSibling.nodeValue?.includes(` ${key} `)
      )
    ) {
      node.nextSibling.remove();
    }
  }

  let newNode;

  if (mode === "text") {
    newNode = document.createTextNode(html);
  } else {
    const template = document.createElement("template");
    template.innerHTML = html;
    newNode = template.content;
  }

  node.parentNode.insertBefore(newNode, node.nextSibling);

  if (mode === "overwrite") {
    node.nextSibling.remove();
    node.remove();
  }
}

function clearNested(key, obj, clearSelf = true) {
  Object.keys(obj).forEach((objKey) => {
    if (typeof objKey === "symbol") {
      return;
    }

    // TODO: See if you can make task keys fit better with the existing system
    const cacheKey = objKey.split("#task")[0];

    if (cacheKey.startsWith(key) && (clearSelf || cacheKey !== key)) {
      delete obj[objKey];
    }
  });
}

function cleanup(key) {
  clearNested(key, elementsByKey);
  clearNested(key, templatesByKey);
  clearNested(key, arrayItemKeysByKey);
  clearNested(key, propsByKey);
  clearNested(key, hookInitsByKey);
  clearNested(key, componentsByKey);
  clearNested(key, accessByKey);
  clearNested(key, enumeratedAccessByKey);
  clearNested(key, taskCallbacksByKey);
}

function cleanupChildren(key) {
  clearNested(key, elementsByKey);
  clearNested(key, templatesByKey);
  clearNested(key, arrayItemKeysByKey);
  clearNested(key, propsByKey, false);
  clearNested(key, hookInitsByKey, false);
  clearNested(key, componentsByKey, false);
  clearNested(key, accessByKey, false);
  clearNested(key, enumeratedAccessByKey, false);
  clearNested(key, taskCallbacksByKey, false);
}

function resolveSignalProps(props) {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => {
      const path = value[PathProperty];
      if (typeof path === "string") {
        return [key, peek(signals.get(value[SignalIdProperty]).signal, path)];
      }

      return [key, value];
    }),
  );
}

const arrayItemKeysByKey = {};

/**
 * Map an array item key, which can be a symbol, string, or number, to a string
 * that can safely be used as a key
 */
function getArrayItemKey(slotKey, assignedKey) {
  const lookup = (arrayItemKeysByKey[slotKey] ||= {
    count: 0,
    keys: {},
    preOwnedKeys: [],
  });

  const key = (lookup.keys[assignedKey] ||= lookup.preOwnedKeys.length
    ? // Reuse keys of removed items to prevent key size from growing without bound
      // as array items are removed and added
      lookup.preOwnedKeys.shift()
    : // Prefix array item keys with i to prevent collisions with non-array
      // item keys
      `i${lookup.count++}`);

  return slotKey + "." + key;
}

/**
 * Mark an array item key as safe to reuse
 */
function freeArrayItemKey(slotKey, assignedKey) {
  const lookup = (arrayItemKeysByKey[slotKey] ||= {
    count: 0,
    keys: {},
    preOwnedKeys: [],
  });

  lookup.preOwnedKeys.push(lookup.keys[assignedKey]);
  lookup.preOwnedKeys.sort();

  delete lookup.keys[assignedKey];
}

function render(key, node, depth = 0, domMutations = []) {
  let template;
  if (isTemplate(node)) {
    template = node;
  } else {
    componentsByKey[key] = node;

    delete accessByKey[key];
    delete enumeratedAccessByKey[key];

    renderStack.push({
      type: "component",
      key,
      onUpdate: () => render(key, node),
    });

    const props = resolveSignalProps(propsByKey[key] || {});

    componentHookIndex = 0;
    template = node(props);
    componentHookIndex = 0;

    renderStack.pop();
  }

  if (isPrimitive(template)) {
    cleanupChildren(key);

    domMutations.push(() =>
      // No need to escape since setHtml with mode "text" calls createTextNode
      setHtml(key, isRenderablePrimitive(template) ? template : "", "text"),
    );

    if (depth === 0 && domMutations.length) {
      domMutations.forEach((mutation) => mutation());
    }

    return;
  }

  template.components ||= node.components;

  if (!template.parsedHtmlPhrases.length) {
    parseTemplateInPlace(template);
  }

  if (!templatesByKey[key] || !isTemplateMatch(templatesByKey[key], template)) {
    cleanupChildren(key);

    const result = renderToString(key, template);

    domMutations.push(() => {
      setHtml(key, result.html);
      hydrate(key, result);
    });

    templatesByKey[key] = template;

    if (depth === 0 && domMutations.length) {
      domMutations.forEach((mutation) => mutation());
    }

    return;
  }

  template.slots.forEach((slot) => {
    const slotKey =
      key + "." + template.identifiers[slot.identifierIndex].suffix;
    const value = template.interpolations[slot.interpolationIndex];
    const prevValue =
      templatesByKey[key].interpolations[slot.interpolationIndex];

    if (isPrimitive(value)) {
      if (prevValue !== value) {
        cleanup(slotKey);

        domMutations.push(() =>
          // No need to escape since setHtml with mode "text" calls
          // createTextNode
          setHtml(slotKey, isRenderablePrimitive(value) ? value : "", "text"),
        );
      }
    } else if (isTemplate(value)) {
      if (
        isPrimitive(prevValue) ||
        !isTemplateMatch(prevValue, value) ||
        !isInterpolationsMatch(prevValue, value)
      ) {
        if (isTemplate(prevValue) && !isTemplateMatch(prevValue, value)) {
          cleanup(slotKey);
        }

        value.components ||= template.components;

        render(slotKey, value, depth + 1, domMutations);
      }
    } else if (Array.isArray(value)) {
      if (isTemplate(prevValue)) {
        cleanup(slotKey);
      }

      if (!value.every(isTemplate)) {
        throw new Error(INVALID_ARRAY_ITEM);
      }

      if (!value.every((item) => isValidKey(item.assignedKey))) {
        throw new Error(MISSING_ARRAY_ITEM_KEY);
      }

      let renderAll = false;
      if (!Array.isArray(prevValue)) {
        renderAll = true;
      } else {
        const prevIndexByKey = Object.fromEntries(
          prevValue.map((prevItem, i) => [prevItem.assignedKey, i]),
        );

        let maxIndex = 0;
        const orderChanged = value.some((item) => {
          const prevIndex = prevIndexByKey[item.assignedKey];
          if (typeof prevIndex === "number") {
            if (prevIndex < maxIndex) {
              return true;
            } else {
              maxIndex = prevIndex;
            }
          }
        });

        orderChanged && debug("Array order changed");
        renderAll = orderChanged;
      }

      if (renderAll) {
        cleanup(slotKey);

        const result = value.reduce(
          (result, item) => {
            item.components ||= template.components;

            const itemKey = getArrayItemKey(slotKey, item.assignedKey);
            const currentResult = renderToString(itemKey, item, {
              html: result.html + `<!-- ${itemKey} -->`,
              listenersByKey: result.listenersByKey,
            });
            currentResult.html += `<!-- ${itemKey} -->`;

            return currentResult;
          },
          { html: "", listenersByKey: {} },
        );

        domMutations.push(() => {
          setHtml(slotKey, result.html);
          hydrate(slotKey, result);
        });
      } else {
        // Removed items
        prevValue.forEach((prevItem) => {
          if (
            !value.some((item) => item.assignedKey === prevItem.assignedKey)
          ) {
            const itemKey = getArrayItemKey(slotKey, prevItem.assignedKey);
            cleanup(itemKey);
            domMutations.push(() => {
              setHtml(itemKey, "", "overwrite");

              // Once the item has been removed from the dom, its key can be
              // reused
              freeArrayItemKey(slotKey, prevItem.assignedKey);
            });
          }
        });

        // Added or changed items
        value.toReversed().forEach((item, i, reversed) => {
          const itemKey = getArrayItemKey(slotKey, item.assignedKey);
          const prevItem = prevValue.find(
            (prevItem) => prevItem.assignedKey === item.assignedKey,
          );

          item.components ||= template.components;

          if (!prevItem) {
            const result = renderToString(itemKey, item);
            const anchor = reversed
              .slice(i + 1)
              .find((item) =>
                prevValue.some(
                  (prevItem) => prevItem.assignedKey === item.assignedKey,
                ),
              );

            domMutations.push(() => {
              const itemHtml = `<!-- ${itemKey} -->${result.html}<!-- ${itemKey} -->`;

              if (anchor) {
                setHtml(
                  getArrayItemKey(slotKey, anchor.assignedKey),
                  itemHtml,
                  "append",
                );
              } else {
                setHtml(slotKey, itemHtml, "insert");
              }

              hydrate(itemKey, result);
            });
          } else if (
            !isTemplateMatch(prevItem, item) ||
            !isInterpolationsMatch(prevItem, item)
          ) {
            render(itemKey, item, depth + 1, domMutations);
          }
        });
      }
    }
  });

  template.attributes.forEach((attr, i) => {
    const attrValue = template.interpolations[attr.interpolationIndex];
    const prevAttrValue =
      templatesByKey[key].interpolations[
        templatesByKey[key].attributes[i].interpolationIndex
      ];

    if (prevAttrValue !== attrValue) {
      domMutations.push(() => {
        const element = getElementByKey(
          key + "." + template.identifiers[attr.identifierIndex].suffix,
        );

        if (!isHtmlTruthy(attrValue)) {
          element.removeAttribute(attr.name);
        } else if (attrValue === true) {
          element.setAttribute(attr.name, "");
        } else {
          element.setAttribute(attr.name, attrValue);
        }

        if (element.tagName === "INPUT") {
          if (
            attr.name === "checked" &&
            element.checked !== isHtmlTruthy(attrValue)
          ) {
            element.checked = isHtmlTruthy(attrValue);
          } else if (
            attr.name === "value" &&
            element.value !== (attrValue ?? "").toString()
          ) {
            element.value = (attrValue ?? "").toString();
          }
        }
      });
    }
  });

  template.listeners.forEach((listener) => {
    const handler = template.interpolations[listener.interpolationIndex];
    const prevHandler =
      templatesByKey[key].interpolations[listener.interpolationIndex];

    if (prevHandler !== handler) {
      domMutations.push(() => {
        const elementKey =
          key + "." + template.identifiers[listener.identifierIndex].suffix;

        getElementByKey(elementKey).removeEventListener(
          listener.event,
          prevHandler,
        );

        getElementByKey(elementKey).addEventListener(listener.event, handler);
      });
    }
  });

  const keysToRerender = new Set();
  const renderedPropsByKey = {};

  template.props.forEach((prop, i) => {
    const propKey =
      key + "." + template.identifiers[prop.identifierIndex].suffix;
    const prevInterp =
      templatesByKey[key].interpolations[prop.interpolationIndex];
    const currentInterp = template.interpolations[prop.interpolationIndex];

    // Check prop equality across renders
    if (
      !keysToRerender.has(propKey) &&
      (templatesByKey[key].props[i].value !== prop.value ||
        (prevInterp !== currentInterp &&
          // Signals with the same id and path are considered equal here since
          // the component will re-render whenever the signal is updated
          !(
            (typeof prevInterp[SignalIdProperty] === "symbol" ||
              typeof currentInterp[SignalIdProperty] === "symbol") &&
            // TODO: Pretty sure if the underlying object reference is the same
            // you can also count the props as equal (think of the todo list case)
            // - children should also get special treatment
            prevInterp[SignalIdProperty] === currentInterp[SignalIdProperty] &&
            prevInterp[PathProperty] === currentInterp[PathProperty]
          )))
    ) {
      keysToRerender.add(propKey);
    }

    renderedPropsByKey[propKey] ||= {};
    renderedPropsByKey[propKey][prop.name] =
      "value" in prop
        ? prop.value
        : template.interpolations[prop.interpolationIndex];
  });

  // Check if the number of props for each key is the same (sufficient with the
  // equality check above)
  Object.keys(renderedPropsByKey).forEach((key) => {
    if (
      !keysToRerender.has(key) &&
      Object.keys(propsByKey[key]).length !==
        Object.keys(renderedPropsByKey[key]).length
    ) {
      keysToRerender.add(key);
    }
  });

  propsByKey = { ...propsByKey, ...renderedPropsByKey };

  keysToRerender
    .values()
    .forEach((key) =>
      render(key, componentsByKey[key], depth + 1, domMutations),
    );

  templatesByKey[key] = template;

  if (depth === 0 && domMutations.length) {
    domMutations.forEach((mutation) => mutation());
  }
}

// TODO: probably wouldn't be too hard to combine these

const accessByKey = {};
const enumeratedAccessByKey = {};

// A weak map removes the need to manually cleanup signal metadata for
// unmounted signals. The cleanup and cleanupChildren functions remove all
// other references which frees them up for garbage collection here
const signals = new WeakMap();

function subscribe(signalId, path, prop) {
  const { key, type } = renderStack.at(-1) || {};

  if (key && type !== "peek") {
    const lookup = prop ? accessByKey : enumeratedAccessByKey;
    const fullPath = prop ? path + "." + prop : path;
    const subscriberAccess = (lookup[key] ||= {});
    const accessByPath = (subscriberAccess[signalId] ||= {});

    if (!accessByPath[fullPath]) {
      accessByPath[fullPath] = renderStack.at(-1);
    }
  }
}

const PathUnreachable = Symbol();

// TODO: escape periods in property names

// Resolve a path within a signal object without subscribing to updates
function peek(obj, path) {
  renderStack.push({ type: "peek" });

  const parts = path.split(".").filter(Boolean);
  if (parts[0] === "[root]") {
    parts.shift();
  }

  let value = obj;
  parts.forEach((part) => {
    if (Array.isArray(value) && !isNaN(parseInt(part))) {
      value = value[parseInt(part)];
    } else if (isPlainObject(value)) {
      value = value[part];
    } else {
      value = PathUnreachable;
    }
  });

  renderStack.pop();

  return value;
}

function shouldDoDeepUpdate(prevValue, currentValue) {
  if (isPlainObject(prevValue) && isPlainObject(currentValue)) {
    return false;
  } else {
    return prevValue !== currentValue;
  }
}

let plannedRenders = 0;

// DEV
// - "enumerated access" should only apply to access that enumerates every
// single item in a list
//   - in this case subscribers should only be notified if the list length
//   changes
//   - the signal prop resolution logic should prevent child components from
//   seeing stale values
//   - probably can treat access to length in a similar way?
//   - push, pop, splice if it changes length, delete, setting an object,
//   property that wasn't present before should trigger subscribers
// - handle primitive values how you currently are
//   - is it really that simple?
//   - might actually be that simple
//   - can you impliment this today?
//   - object truthiness counts as a primitive
// - enumerating object methods:
//   - has trap, ownKeys trap
// - enumerating array methods
//   - all non-mutating array methods
//     - splice and toSpliced are special in that they should only be notified
//     if the length of their return value changes
//     - actually, this should be true of all enumerated access
//   - for the initial implementation, you can probably treat all array methods
//   as enumerating

const new_access = {};

// DEV: explain
const ENUMERATED_KEYS = Symbol();

function new_subscribe(signalId, path, property, slice) {
  const { key, type } = renderStack.at(-1) || {};

  if (key && type !== "peek") {
    // DEV: is an undefined target possible?
    const target = peek(signals.get(signalId).rawValue, path);
    // DEV: not quite right
    const subscriptions = new_access[key][signalId][path];

    if (property === ENUMERATED_KEYS) {
      subscriptions[property] = { value: Object.keys(target).length };
      return;
    }

    const value = target[property];
    if (!isPrimitive(value)) {
      // DEV: is it really this simple?
      return;
    }

    if (Array.isArray(target) && property === "length") {
      subscriptions[property] = {
        value: slice ? target.slice(slice.start, slice.end).length : value,
        slice,
      };

      return;
    }

    subscriptions[property] = { value };
  }
}

function notifySubscribers(signalId, path, prop, value) {
  const { prevValues } = signals.get(signalId);
  const plannedUpdatesByKey = {};

  // Notify subscribers in enumeratedAccessByKey even if prev and current values
  // are equal according to ===. For subscribers that enumerate object
  // properties or array items, a value may have changed in a meaningful way
  // even if it has the same reference, e.g. because of a call to .push on an
  // array or the setting of an object property
  [
    ...Object.getOwnPropertySymbols(enumeratedAccessByKey),
    ...Object.keys(enumeratedAccessByKey),
  ].forEach((key) => {
    const update = enumeratedAccessByKey[key]?.[signalId]?.[path];
    if (update) {
      plannedUpdatesByKey[key] = update;
    }
  });

  // Notify subscribers in accessByKey only about meaningful changes to leaf
  // nodes. A change is meaningful if:
  // - prev and current primitive values are no longer equal
  // - a value is changing from a primitive to a non-primitive value or vice
  //   versa (changing from branch to leaf or leaf to branch)
  // - a path has become unreachable
  if (prop) {
    const pathWithProp = path + "." + prop;
    const keys = [
      ...Object.getOwnPropertySymbols(accessByKey),
      ...Object.keys(accessByKey),
    ];

    for (const key of keys) {
      if (key in plannedUpdatesByKey) continue;

      Object.entries(accessByKey[key]?.[signalId] || {}).forEach(
        ([deepPath, update]) => {
          if (deepPath === pathWithProp) {
            if (shouldDoDeepUpdate(prevValues[pathWithProp], value)) {
              plannedUpdatesByKey[key] = update;
            }
          } else if (deepPath.startsWith(pathWithProp + ".")) {
            const pathToCheck = deepPath.slice(pathWithProp.length + 1);

            if (
              shouldDoDeepUpdate(
                peek(prevValues[pathWithProp], pathToCheck),
                peek(value, pathToCheck),
              )
            ) {
              plannedUpdatesByKey[key] = update;
            }
          }
        },
      );
    }
  }

  plannedRenders += Object.values(plannedUpdatesByKey).filter(
    (update) => update.type === "component",
  ).length;

  // Schedule tasks defined outside of components. See comment below for why
  // tasks must be scheduled before components render
  Object.getOwnPropertySymbols(plannedUpdatesByKey).forEach((key) =>
    plannedUpdatesByKey[key].onUpdate(),
  );

  Object.entries(plannedUpdatesByKey)
    .sort(([a], [b]) => {
      const isATask = a.includes("#task");
      const isBTask = b.includes("#task");

      // TODO: Should sort by number of path segments instead
      // of length

      // Sort tasks first so that the deferredTasks array is taken care of when
      // rendering completes
      return isATask && !isBTask
        ? -1
        : !isATask && isBTask
          ? 1
          : // After tasks, sort shorter keys first so that parent components
            // render before their children
            a.length - b.length;
    })
    .forEach(([key, update]) => {
      // One last check to make sure the key hasn't been cleaned up
      if (enumeratedAccessByKey[key] || accessByKey[key]) {
        update.onUpdate({ plannedRenders });
      }

      if (update.type === "component") {
        plannedRenders--;
      }
    });

  if (plannedRenders === 0) {
    while (deferredTasks.length) {
      deferredTasks.shift()();
    }
  }
}

const PathProperty = Symbol();
const SignalIdProperty = Symbol();

class ProxyHandler {
  #signalId;
  #path;

  constructor(signalId, path) {
    this.#signalId = signalId;
    this.#path = path;
  }

  get(target, prop, receiver) {
    if (prop === SignalIdProperty) {
      return this.#signalId;
    }

    if (prop === PathProperty) {
      return this.#path;
    }

    let proxied;
    const value = Reflect.get(target, prop, receiver);

    if (Array.isArray(value) || isPlainObject(value)) {
      if (typeof value[PathProperty] === "string") {
        proxied = value;
        proxied[PathProperty] = this.#path + "." + prop;
      } else {
        proxied = new Proxy(
          value,
          new ProxyHandler(this.#signalId, this.#path + "." + prop),
        );
      }
    } else {
      proxied = value;
    }

    if (renderStack.length) {
      if (
        Array.isArray(target) &&
        (typeof value === "function" || prop === "length")
      ) {
        subscribe(this.#signalId, this.#path);
      } else {
        subscribe(this.#signalId, this.#path, prop);
      }
    }

    if (
      Array.isArray(target) &&
      (prop === "splice" ||
        prop === "fill" ||
        prop === "sort" ||
        prop === "reverse" ||
        prop === "shift" ||
        prop === "unshift" ||
        prop === "push" ||
        prop === "pop")
    ) {
      return (...args) => {
        debug("calling proxied", prop);

        // TODO: In order to handle the case where an array is mutated via
        // method but accessed elsewhere via arr[n], you'll need to track the
        // mutations that occur during method execution, and then let
        // subscribers know about them when the method is complete
        const result = target[prop](...args);

        notifySubscribers(this.#signalId, this.#path);

        return result;
      };
    }

    return proxied;
  }

  has(target, prop, receiver) {
    subscribe(this.#signalId, this.#path);

    return Reflect.has(target, prop, receiver);
  }

  ownKeys(target) {
    subscribe(this.#signalId, this.#path);

    return Reflect.ownKeys(target);
  }

  set(target, prop, value, receiver) {
    if (prop === PathProperty) {
      this.#path = value;
      return true;
    }

    const { prevValues } = signals.get(this.#signalId);
    prevValues[this.#path + "." + prop] = peek(target, prop);

    Reflect.set(target, prop, value, receiver);

    notifySubscribers(this.#signalId, this.#path, prop, value);

    return true;
  }

  // TODO: Notify non-enumerated subs
  deleteProperty(target, prop) {
    Reflect.deleteProperty(target, prop, receiver);

    notifySubscribers(this.#signalId, this.#path);

    return true;
  }
}

const hookInitsByKey = {};

let componentHookIndex = 0;

// TODO: Seems like you could dry this up a bit
export function signal(initialValue) {
  const currentKey =
    renderStack.at(-1)?.type === "component"
      ? renderStack.at(-1).key
      : undefined;

  let result;
  if (currentKey) {
    const existing = hookInitsByKey[currentKey]?.[componentHookIndex];

    if (existing) {
      result = existing;
    } else {
      const symbol = Symbol();
      const root = { val: initialValue };

      hookInitsByKey[currentKey] ||= {};
      result = hookInitsByKey[currentKey][componentHookIndex] = new Proxy(
        root,
        new ProxyHandler(symbol, "[root]"),
      );

      signals.set(symbol, {
        prevValues: {},
        rawValue: root,
        signal: result,
      });
    }

    ++componentHookIndex;
  } else {
    const symbol = Symbol();
    const root = { val: initialValue };
    result = new Proxy(root, new ProxyHandler(symbol, "[root]"));

    signals.set(symbol, {
      prevValues: {},
      rawValue: root,
      signal: result,
    });
  }

  return result;
}

const deferredTasks = [];
const taskCallbacksByKey = {};

// DEV: The prop resolution logic is important for tasks?
// - Will you need to extend it?
// - Otherwise, will there be issues if a task references a signal object
// directly and not via something.object?
// - this might only matter for arrays?
// - what about unattached objects?

// TODO: Allow returning a cleanup function
export function task(callback) {
  const componentKey =
    renderStack.at(-1)?.type === "component"
      ? renderStack.at(-1).key
      : undefined;

  const isFirstRender = !hookInitsByKey[componentKey]?.[componentHookIndex];
  const taskKey = componentKey
    ? `${componentKey}#task-${componentHookIndex}`
    : Symbol();

  if (componentKey) {
    hookInitsByKey[componentKey] ||= {};
    hookInitsByKey[componentKey][componentHookIndex] = true;
    ++componentHookIndex;
  }

  taskCallbacksByKey[taskKey] = callback;

  const doTask = () => {
    renderStack.push({
      type: "task",
      key: taskKey,
      onUpdate: () => {
        if (renderStack.at(-1)?.key === taskKey) {
          // Prevent infinite recursion by doing nothing if the update happened
          // during the task itself
          return;
        }

        if (plannedRenders > 0) {
          // Wait to execute tasks until rendering is complete
          deferredTasks.push(doTask);
        } else {
          doTask();
        }
      },
    });

    delete accessByKey[taskKey];
    delete enumeratedAccessByKey[taskKey];

    taskCallbacksByKey[taskKey]();

    renderStack.pop();
  };

  if (!componentKey || isFirstRender) {
    deferredTasks.push(doTask);
  }
}
