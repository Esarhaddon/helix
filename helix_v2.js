function isMergeable(phrase) {
  return (
    phrase &&
    !("identifier" in phrase) &&
    !("templateChildIndex" in phrase) &&
    !phrase.isComponentTag
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
      pushPhrase({ identifier: "IDENTIFIER", suffix: getSuffix() });
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
        pushPhrase({ value: unparsedFragment });

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
              value: unparsedFragment.slice(0, controlCharsIndex),
            });
          }

          if (/[A-Z]/.test(unparsedFragment[controlCharsIndex + 1])) {
            isComponentTag = true;

            // Don't increment the suffix since this is an opening tag
            pushPhrase({ identifier: "IDENTIFIER", suffix: getSuffix() });
          }

          pushPhrase({ tagStart: true, value: "<" });

          if (isComponentTag) {
            Object.assign(prevPhrase(), {
              isComponentTag: true,
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
              value: unparsedFragment.slice(0, controlCharsIndex + 2),
            });
          }

          isClosingTag = true;

          break;
        case ">":
          if (!isComponentTag) {
            pushPhrase({
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
            pushPhrase({ identifier: "IDENTIFIER", suffix: getSuffix() });
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
      pushPhrase({ identifier: "IDENTIFIER", suffix: getSuffix() });
      pushPhrase({ templateChildIndex: i, type: "slot" });
    } else if (isOpeningTag && !isComponentTag) {
      const phrases = levelsStack.at(-1).phrases;
      const start = phrases.findLastIndex((phrase) => phrase.tagStart);

      if (!phrases[start - 1] || !("identifier" in phrases[start - 1])) {
        phrases.splice(start, 0, {
          identifier: "IDENTIFIER",
          suffix: getSuffix(),
        });
        incSuffix();
      }

      pushPhrase({ templateChildIndex: i, type: "attribute" });
    }
  });

  template.parsedHtmlFragments = mergePhrases(template.parsedHtmlFragments);
}

const test = getTemplateBuilderV2();

const template = test`
  this is just a string
  <div id="my-div">
    <Component ${{}} id="<_adfa>k<>" ${{}} onClick=${() => {}} />
    hello world
    <span spanid="my-span<<><'" id=${{}} onclick=${() => {}}></span>
    <input oninput=${() => {}} />
  </div>
  <div>hello world</div>
  <Component onClick=${() => {}} id=${null}>
    <span>
      hello world
      ${{}}
      <div>even moar nested</div>
      <AnotherComponent 
        ${{ greeting: "hello world" }} 
        class="my-class"
      >
        <div onclick=${() => {}}>You still need to match tags?</div>
        <div onclick=${() => {}}>Very cool that this is working now</div>
      </AnotherComponent>
      does this work?
    </span>
  </Component>
  <span>last little bit</span>
`;

console.log(JSON.stringify(template, null, 2));

parseTemplateInPlaceV2(template);

console.log(JSON.stringify(template, null, 2));
