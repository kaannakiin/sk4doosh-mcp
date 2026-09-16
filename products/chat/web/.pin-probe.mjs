import { JSDOM } from "/private/tmp/claude-501/-Users-kaanakin-Desktop-sk-mcp/8208b31c-133d-47d5-9e98-8eab853a6fed/scratchpad/domtest/node_modules/jsdom/lib/api.js";

const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
for (const k of ["window","document","navigator","HTMLElement","Element","Node","Event","KeyboardEvent","InputEvent","MouseEvent","getComputedStyle","requestAnimationFrame","cancelAnimationFrame","DOMRect","ResizeObserver"]) {
  if (globalThis[k] === undefined) globalThis[k] = dom.window[k];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { MantineProvider, PinInput, Input } = await import("@mantine/core");

function Harness({ gip }) {
  const [code, setCode] = useState("");
  return h(MantineProvider, null,
    h(Input.Wrapper, { labelElement: "div", label: "code" },
      h(PinInput, {
        length: 6, type: "number", size: "md", value: code, onChange: setCode,
        ...(gip ? { getInputProps: () => ({ className: "font-mono", onPaste: () => {} }) } : {}),
      })));
}

async function run(gip) {
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(h(Harness, { gip })); });

  const inputs = [...host.querySelectorAll("input[type=tel]")];
  inputs[0].focus();

  const setVal = dom.window.Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  for (const digit of ["1", "2", "3"]) {
    const active = dom.window.document.activeElement;
    await act(async () => {
      setVal.call(active, digit);
      active.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }
  const focusedIndex = inputs.indexOf(dom.window.document.activeElement);
  console.log(`gip=${gip} -> values=[${inputs.map((i) => i.value).join(",")}] focusedIndex=${focusedIndex}`);
  await act(async () => { root.unmount(); });
}

await run(false);
await run(true);
