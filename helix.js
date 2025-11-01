// TODO:
// - [x] modules
// - [x] identifiers in html comments
// - [x] drop web components
// - [ ] production ready parsing
// - [ ] fix arrays
// - [ ] some optimization
// - [ ] useTask
// - [ ] SSR/resumability

const eventTarget = new EventTarget();
const components = {};
const instances = {};
const eventHandlers = {};
const propsByNodeKey = {};
const propsByParentNodeKey = {};
const previousPropsByNodeKey = {};

// DEV:
// - build the data structure
// - parse it for rendering

let currentInstanceKey;
let currentInstanceSignalIndex = 0;

const counts = {};
const unprefixed = Symbol();

function getId(prefix) {
  const key = prefix || unprefixed;
  counts[key] ||= 0;

  return (prefix ? prefix + "_" : "") + ++counts[key];
}

function isPrimitive(value) {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    value === undefined ||
    value === null
  );
}

function isNullishPrimitive(value) {
  return value === null || value === undefined;
}

function isObject(obj) {
  return Boolean(obj && typeof obj === "object" && !Array.isArray(obj));
}

function snakeCase(str) {
  return str
    .split("")
    .flatMap((char, i) => (/[A-Z]/.test(char) && i !== 0 ? ["-", char] : char))
    .join("")
    .toLowerCase();
}

function findElementKey(element) {
  let node = element.previousSibling;

  while (node.nodeType !== Node.COMMENT_NODE || !node.nodeValue.trim()) {
    node = node.previousSibling;
  }

  return node.nodeValue.trim();
}

function addEventListener(instanceKey, event, listener) {
  instances[instanceKey].listeners ||= {};
  instances[instanceKey].listeners[event] = listener;

  eventTarget.addEventListener(event, listener);
}

function cleanupChildren(instanceKey) {
  const staleInstances = Object.entries(instances).filter(
    ([key]) => key !== instanceKey && key.startsWith(instanceKey)
  );

  staleInstances.forEach(([key, instance]) => {
    Object.entries(instance.listeners).forEach(([event, listener]) => {
      eventTarget.removeEventListener(event, listener);
    });

    delete instances[key];
  });
}

function setHtml(key, html) {
  const node = document.evaluate(
    `//comment()[contains(string(), " ${key} ")]`,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE
  ).singleNodeValue;

  let nextSibling = node.nextSibling;
  while (
    nextSibling &&
    (nextSibling.nodeType !== Node.COMMENT_NODE ||
      !nextSibling.nodeValue?.includes(` ${key} `))
  ) {
    nextSibling.remove();
    nextSibling = node.nextSibling;
  }

  const target = document.createElement("div");
  const host = document.createElement("div");

  host.innerHTML = html;
  node.parentNode.insertBefore(target, node.nextSibling);
  target.replaceWith(...host.childNodes);
}

function setText(key, text) {
  const node = document.evaluate(
    `//comment()[contains(string(), " ${key} ")]`,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE
  ).singleNodeValue;

  let nextSibling = node.nextSibling;
  while (
    nextSibling &&
    (nextSibling.nodeType !== Node.COMMENT_NODE ||
      !nextSibling.nodeValue?.includes(` ${key} `))
  ) {
    nextSibling.remove();
    nextSibling = node.nextSibling;
  }

  node.parentNode.insertBefore(document.createTextNode(text), node.nextSibling);
}

function getCustomElementName(componentName) {
  return "hlx-" + snakeCase(componentName);
}

function define(componentName, scope) {
  if (!components[componentName]) {
    const component = isObject(scope[componentName])
      ? scope[componentName][componentName]
      : scope[componentName];

    const Component = class extends HTMLElement {
      constructor() {
        super();
        this.handleSignalUpdate = this.handleSignalUpdate.bind(this);
        this.handlePropsChange = this.handlePropsChange.bind(this);
      }

      connectedCallback() {
        this.key = findElementKey(this);

        render(this, component);

        addEventListener(this.key, "signalUpdate", this.handleSignalUpdate);
        addEventListener(this.key, "propsChange", this.handlePropsChange);
      }

      handleSignalUpdate({ detail: { id, path } }) {
        if (instances[this.key].signalAccess?.[id]?.includes(path)) {
          render(this.key, component);
        }
      }

      handlePropsChange({ detail: { key } }) {
        if (key === this.key) {
          render(this.key, component);
        }
      }
    };

    customElements.define(getCustomElementName(componentName), Component);
    components[componentName] = {
      componentName,
      component: Component,
      registered: true,
    };
  }
}

function parseComponents(html, components) {
  let parsed = html;
  const ogHtmlLength = html.length;
  const componentNames = [];

  [...html.matchAll(/<([A-Z][a-zA-Z0-9]*)[^>]*>/g)].forEach((match, i) => {
    const [tag, componentName] = match;
    define(componentName, components);
    componentNames.push(componentName);

    const marker = "<!-- HLX_NODE_KEY -->";

    parsed = parsed
      .split("")
      .toSpliced(
        match.index - ogHtmlLength,
        tag.length,
        (parsed.slice(0, match.index - ogHtmlLength).endsWith(marker)
          ? ""
          : marker) +
          tag +
          (tag.endsWith("/>") ? `</${componentName}>` : "")
      )
      .join("");
  });

  componentNames.forEach((componentName) => {
    parsed = parsed.replaceAll(
      componentName,
      getCustomElementName(componentName)
    );
  });

  return parsed;
}

// Call it getTemplateBuilder?
function getTemplateBuilder_new(key, defaultStrings, ...defaultChildren) {
  return (strings, ...children) => {
    // DEV: one of these is read only?
    const htmlFragments = [...strings] || [...defaultStrings];

    htmlFragments[0] = htmlFragments[0].trimLeft();
    htmlFragments[htmlFragments.length - 1] =
      htmlFragments[htmlFragments.length - 1].trimRight();

    return {
      _isTemplateNode: true,
      assignedKey: key,
      htmlFragments,
      templateChildren: children || defaultChildren,
    };
  };
}

// DEV: shouldn't be too hard to test this

// DEV: maybe you're not thinking about this quite the right way?

// DEV: at some point you'll need to handle escape chars
function parseTemplateInPlace(template) {
  // DEV: should these have better names?
  let isTag = false;
  let isAttr = false;

  template.parsed = template.htmlFragments.reduce((result, fragment) => {
    // DEV: there might be a more effici
    const fragmentResults = [];

    let unparsedFragment = fragment;
    while (unparsedFragment.length) {
      let controlCharIndex = unparsedFragment.split("").findIndex(
        (char, i) =>
          // Attribute start or end
          (isTag && char === '"') ||
          (isTag && !isAttr && char === ">") ||
          // Tag start
          (!isTag && !isAttr && char === "<")
      );

      let controlChar = unparsedFragment[controlCharIndex];

      // DEV: very interesting and complicated

      if (controlCharIndex < 0) {
        console.log("index less than zero");
        fragmentResults.push({ value: unparsedFragment, isTag, isAttr });
      } else {
        console.log({ controlCharsIndex: controlCharIndex });
        console.log({ controlChars: controlChar });

        switch (controlChar) {
          case '"':
            // DEV: if opening, this should start a new phrase, if closing this
            // should end the current phrase

            isAttr = !isAttr;
            break;
          case ">":
            // DEV: this should end the current phrase

            isTag = false;
            break;
          case "<":
            // DEV: this should start a new phrase

            isTag = true;
            break;
        }

        fragmentResults.push({
          isAttr,
          isTag,
          value: unparsedFragment.slice(0, controlCharIndex + 1),
        });
      }

      unparsedFragment =
        controlCharIndex < 0
          ? ""
          : unparsedFragment.slice(controlCharIndex + 1);
    }

    return result.concat(fragmentResults);
  }, []);
}

const test = getTemplateBuilder_new();

const template = test`
  <div onclick=${() => {}}>hello world<span id="excl">!</span></div>
`;

console.log(JSON.stringify(template, null, 2));

const testResult = parseTemplateInPlace(template);

console.log(JSON.stringify(template, null, 2));

// DEV: should this work in place?
// - fillTemplate?
function fillTemplate_new(
  value, // DEV: this is either going to be an array of template nodes or a single template node
  // - actually, it's always going to be a single template node?
  key
  // parent, // DEV: no need for a descendant index?
  // // DEV: should not be incremented if a key has been provided
  // siblingIndex
) {
  value.key = key;
  // DEV: parse and transform each string and non-template node fragment,
  // recurse into single template nodes and arrays of template nodes
  // - these would need to be wrapped in identifiers
  // - could this actually end up being a lot simpler than what you had before?
  // - maybe just add a addHtml fn?
  value.parsed = value.fragments;

  // DEV: a parsed string fragment might look something like this:
  const parsed = {
    identifier: key + "." + 0,
    type: "html",
    value: "<div onclick=",
  };

  // DEV: is it possible to parse the string fragments at the same time that you
  // recurse?
  // - or maybe the move is to massage them into an easily parsable format so
  //   you can call getHtml for a node later?

  // if (value === null || value === undefined || value === "string") {
  //   // DEV: actually, you don't need this branch?
  //   // DEV: we're dealing with some kind of primitive value
  // } else if (value._isTemplateNode) {
  // value.key = (parent?.key || "") + (value.key ? "key_" + value.key : "");
  // value.key = parent.key + "." + (value.assignedKey || siblingIndex); // DEV: maybe the key should just be assigned by the caller?
  // value.key = key;
  // value.parsed = value.fragments; // DEV: parse and transform each string and non-template node fragment, recurse into single template nodes and arrays of template nodes

  // DEV: do some recursion
  // DEV: fill keys here
  // } else if (Array.isArray(value)) {
  //   // DEV: you also don't need this branch?
  //   // DEV: should be an array of tree nodes, otherwise throw error
  // }
}

function getHtml(templateNode) {}

function getTemplateBuilder(
  components,
  key,
  defaultStrings,
  ...defaultChildren
) {
  return (strings, ...children) => {
    const templateChildren = children.length ? children : defaultChildren;
    const fragments = strings || defaultStrings;

    const childNodes = templateChildren.flatMap((child) => {
      if (typeof child === "function") {
        return { handler: child };
      } else if (isPrimitive(child)) {
        return {
          primitive: true,
          // TODO: escape this
          html: isNullishPrimitive(child) ? "" : child.toString(),
        };
      } else {
        return child;
      }
    });

    return {
      key,
      template: parseComponents(
        fragments.reduce((result, fragment, i) => {
          if (i === 0) {
            return fragment;
          }

          const lastTagStart = result
            .split("")
            .findLastIndex((char) => char === "<");

          if (
            lastTagStart >
            result.split("").findLastIndex((char) => char === ">")
          ) {
            const isAttribute = result.endsWith("=");
            const isProps =
              result.endsWith("...") && isObject(childNodes[i - 1]);

            if (isAttribute) {
              const attributeName = result.slice(
                result.split("").findLastIndex((char) => char === " ") + 1,
                -1
              );

              childNodes[i - 1].attribute = true;
              childNodes[i - 1].name = attributeName;
            } else if (isProps) {
              childNodes[i - 1] = {
                values: childNodes[i - 1],
                isProps: true,
              };
            }

            const marker = "<!-- HLX_NODE_KEY -->";

            return (
              result.slice(0, lastTagStart) +
              (result.slice(0, lastTagStart).endsWith(marker) ? "" : marker) +
              result.slice(lastTagStart) +
              (isAttribute ? '"HLX_ATTR"' : isProps ? "HLX_PROPS" : "") +
              fragment
            );
          } else {
            return (
              result +
              (Array.isArray(templateChildren[i - 1])
                ? Array(templateChildren[i - 1].length)
                    .fill("HLX_SLOT")
                    .join("")
                : "HLX_SLOT") +
              fragment
            );
          }
        }, ""),
        components
      ),
      props: childNodes.filter((child) => child.isProps),
      attributes: childNodes.filter((child) => child.attribute),
      children: childNodes.filter(
        (child) => !child.attribute && !child.isProps
      ),
    };
  };
}

export default function helix() {
  return function hlx(stringsOrConfig, ...children) {
    if (Array.isArray(stringsOrConfig)) {
      const strings = stringsOrConfig;
      return getTemplateBuilder(
        hlx.components,
        undefined,
        strings,
        ...children
      )();
    } else if (typeof stringsOrConfig === "string") {
      const key = stringsOrConfig;
      return getTemplateBuilder(hlx.components, key);
    } else {
      const config = stringsOrConfig;
      return getTemplateBuilder(hlx.components, config.key);
    }
  };
}

function fillTemplate(node, key = "", parents = []) {
  const { template, children, attributes, props } = node;

  node.key = currentInstanceKey + (key ? "-" + key : "");

  let charIndex = 0;
  let slotIndex = 0;
  let nodeIndex = 0;
  let assignedChildKeyCount = 0;

  const matches = [
    ...template.matchAll(
      /(HLX_SLOT)|(HLX_NODE_KEY)|(HLX_ATTR)|(\.\.\.HLX_PROPS)/g
    ),
  ];

  const attributeKeys = [];
  const childKeys = [];
  const propsKeys = [];
  const prefixedBaseKey = currentInstanceKey + "-" + (key ? key + "." : "");

  node.html = matches.length ? "" : node.template;

  matches.forEach((match) => {
    switch (match[0]) {
      case "HLX_SLOT":
        const assignedChildKey = node.children[slotIndex].key
          ? "key-" + node.children[slotIndex].key
          : undefined;

        if (assignedChildKey) {
          assignedChildKeyCount++;
        }

        const unprefixedKey =
          (key ? key + "." : "") +
          "slot." +
          (assignedChildKey || slotIndex - assignedChildKeyCount);
        const prefixedKey = currentInstanceKey + "-" + unprefixedKey;

        childKeys.push(unprefixedKey);
        node.html +=
          template.slice(charIndex, match.index) +
          `<!-- ${prefixedKey} -->HLX_CHILD_${prefixedKey}<!-- ${prefixedKey} -->`;
        charIndex = match.index + "HLX_SLOT".length;
        slotIndex++;

        break;
      case "HLX_NODE_KEY":
        node.html +=
          template.slice(charIndex, match.index) + prefixedBaseKey + nodeIndex;
        charIndex = match.index + "HLX_NODE_KEY".length;
        nodeIndex++;

        break;
      case "HLX_ATTR":
        attributeKeys.push(prefixedBaseKey + (nodeIndex - 1));
        node.html +=
          template.slice(charIndex, match.index) +
          "HLX_ATTR_" +
          prefixedBaseKey +
          (nodeIndex - 1);
        charIndex = match.index + "HLX_ATTR".length;

        break;
      case "...HLX_PROPS":
        propsKeys.push(prefixedBaseKey + (nodeIndex - 1));
        node.html += template.slice(charIndex, match.index);
        charIndex = match.index + "...HLX_PROPS".length;

        break;
    }
  });

  if (matches.length) {
    node.html += template.slice(charIndex);
  }

  props.forEach((props, i) => {
    props.key = propsKeys[i];

    if (!propsByNodeKey[props.key]) {
      previousPropsByNodeKey[props.key] = props.values;
    }
    propsByNodeKey[props.key] = props.values;

    propsByParentNodeKey[currentInstanceKey] ||= {};
    propsByParentNodeKey[currentInstanceKey][props.key] = props.values;
  });

  attributes.forEach((attribute, i) => {
    attribute.key = attributeKeys[i];

    if (attribute.handler) {
      eventHandlers[`HLX_ATTR_${attribute.key}`] = attribute.handler;

      attribute.html = `
        (function (e){
          document.dispatchEvent(
            new CustomEvent('wrappedEvent', {
              detail: {event, key: 'HLX_ATTR_${attribute.key}' }
            })
          );
        })(event)
      `;
    }

    node.html = node.html.replace("HLX_ATTR_" + attribute.key, attribute.html);
  });

  children.forEach((child, i) => {
    const unprefixedKey = childKeys[i];

    if (child.primitive) {
      child.key = currentInstanceKey + "-" + unprefixedKey;
      node.html = node.html.replace(`HLX_CHILD_${child.key}`, child.html);
    } else {
      fillTemplate(child, unprefixedKey, [...parents, node]);
    }
  });

  parents.forEach(
    (parent) =>
      (parent.html = parent.html.replace(
        `HLX_CHILD_${currentInstanceKey + "-" + key}`,
        node.html
      ))
  );

  return node;
}

function makeDeepSignalProxy(value, path, signalId) {
  const proxy = new Proxy(value, {
    get(target, prop) {
      if (prop === "_isProxy") {
        return true;
      }

      const result = target[prop];
      const resultPath = (path ? path + "." : "") + prop;

      if (currentInstanceKey) {
        instances[currentInstanceKey].signalAccess ||= {};
        instances[currentInstanceKey].signalAccess[signalId] ||= [];
        instances[currentInstanceKey].signalAccess[signalId].push(resultPath);
      }

      if (isPrimitive(result) || result._isProxy) {
        return result;
      } else {
        return makeDeepSignalProxy(result, resultPath, signalId);
      }
    },

    set(target, prop, value) {
      const shouldSendEvent = !(target[prop] === value);
      target[prop] = value;

      if (shouldSendEvent) {
        eventTarget.dispatchEvent(
          new CustomEvent("signalUpdate", {
            detail: { id: signalId, path: (path ? path + "." : "") + prop },
          })
        );
      }

      return true;
    },
  });

  return proxy;
}

function _signal(initialValue) {
  const id = getId("signal");

  return {
    id,
    proxy: makeDeepSignalProxy({ value: initialValue }, "", id),
  };
}

export function createSignal(initialValue) {
  return _signal(initialValue).proxy;
}

// Some of the rules of hooks apply
export function useSignal(initialValue) {
  const instanceSignals = currentInstanceKey
    ? instances[currentInstanceKey].signals
    : undefined;

  let signal = instanceSignals?.[currentInstanceSignalIndex];

  if (!signal) {
    signal = _signal(initialValue);
    instanceSignals?.push(signal);
  }

  if (currentInstanceKey) {
    currentInstanceSignalIndex++;
  }

  return signal.proxy;
}

function getDomMutations(prev, next, mutations = []) {
  const element = document.evaluate(
    `//comment()[contains(string(), " ${next.key} ")]`,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE
  ).singleNodeValue?.nextSibling;

  if (next.attribute && prev.html !== next.html) {
    element.setAttribute(next.name, next.html);

    // Keep the input's value *property* in sync with its value *attribute*
    if (
      element instanceof HTMLInputElement &&
      next.name === "value" &&
      element.value !== next.html
    ) {
      element.value = next.html;
    }
  } else if (!next.attribute && next.primitive && prev.html !== next.html) {
    mutations.push(() => {
      !prev.primitive && cleanupChildren(next.key);
      setText(next.key, next.html);
    });
  } else if (prev.template !== next.template) {
    mutations.push(() => {
      cleanupChildren(next.key);
      setHtml(next.key, next.html);
    });
  } else {
    next.children?.forEach((child, i) => {
      getDomMutations(prev?.children[i], child, mutations);
    });
    next.attributes?.forEach((attribute, i) => {
      getDomMutations(prev?.attributes[i], attribute, mutations);
    });
  }

  return mutations;
}

function render(destination, component) {
  const destinationKey =
    typeof destination === "string" ? destination : findElementKey(destination);

  const isFirstRender = !instances[destinationKey];

  const element =
    destination instanceof Element
      ? destination
      : isFirstRender
      ? document.evaluate(
          `//comment()[contains(string(), " ${destinationKey} ")]`,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE
        ).singleNodeValue?.nextSibling
      : undefined;

  if (isFirstRender && element.innerHTML) {
    propsByNodeKey[destinationKey] ||= {};
    propsByNodeKey[destinationKey].children = element.innerHTML;
  }

  instances[destinationKey] ||= {
    signals: [],
    childKeys: {},
  };

  currentInstanceSignalIndex = 0;
  currentInstanceKey = destinationKey;

  const results = fillTemplate(component(propsByNodeKey[destinationKey]));

  if (!isFirstRender) {
    getDomMutations(instances[destinationKey].prevTemplate, results).forEach(
      (mutation) => mutation()
    );

    Object.entries(propsByParentNodeKey[currentInstanceKey] || {}).forEach(
      ([nodeKey, props]) => {
        if (
          !Object.entries(props).every(
            ([propKey, value]) =>
              previousPropsByNodeKey[nodeKey][propKey] === value
          )
        ) {
          eventTarget.dispatchEvent(
            new CustomEvent("propsChange", { detail: { key: nodeKey } })
          );
        }
        previousPropsByNodeKey[nodeKey] = props;
      }
    );
  } else {
    element.innerHTML = results.html;
    element.after(document.createComment(` ${destinationKey} `));
    element.replaceWith(...element.childNodes);
  }

  instances[destinationKey].prevTemplate = results;

  currentInstanceKey = undefined;
}

function populateScopes(components) {
  if (typeof components.hlx === "function" && !components.hlx.components) {
    components.hlx.components = components;
  }

  Object.values(components).forEach((value) => {
    if (isObject(value)) {
      populateScopes(value);
    }
  });
}

export function createRoot(domNode, components) {
  populateScopes(components);

  return {
    render(application) {
      const destinationKey = "hlx";
      const destination = document.createElement("div");

      domNode.replaceChildren(
        document.createComment(` ${destinationKey} `),
        destination,
        document.createComment(` ${destinationKey} `)
      );

      // Handle events
      document.addEventListener("wrappedEvent", (event) => {
        eventHandlers[event.detail.key](event.detail.event);
      });

      // Re-render the root component when its signals are updated
      eventTarget.addEventListener(
        "signalUpdate",
        ({ detail: { id, path } }) => {
          if (instances[destinationKey].signalAccess?.[id]?.includes(path)) {
            render(destinationKey, application);
          }
        }
      );

      render(destination, application);
    },
  };
}
