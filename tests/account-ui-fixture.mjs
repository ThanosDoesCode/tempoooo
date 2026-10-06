import { presentationComponent } from "./presentation-component-fixture.mjs";

// Execute the authored component and its event handlers. Stateful hooks remain persistent
// across renders; dependencies and effect cleanups match the React lifecycle used here.
export function accountUI(file, exportName, modules = {}, props = {}, globals = {}) {
  const slots = [];
  let cursor = 0;
  let changed = false;
  let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [
        slots[i].value,
        (value) => {
          const next = typeof value === "function" ? value(slots[i].value) : value;
          if (!Object.is(next, slots[i].value)) {
            slots[i].value = next;
            changed = true;
          }
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { current: initial };
      return slots[i];
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useCallback(fn, deps) {
      return react.useMemo(() => fn, deps);
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          slots[i].cleanup = fn();
        });
      }
    },
  };
  const timers = new Map();
  let nextTimer = 0;
  const browser = {
    setTimeout(fn) {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener() {},
    removeEventListener() {},
    location: { origin: "https://tempo.test" },
  };
  const route = {
    createFileRoute: () => (options) => ({ options, useSearch: () => ({}) }),
    useNavigate: () => async () => {},
    Link: "Link",
  };
  const dialog = Object.fromEntries(
    ["Root", "Trigger", "Portal", "Overlay", "Content", "Title", "Description", "Close"].map(
      (name) => [name, `Dialog.${name}`],
    ),
  );
  const compiled = presentationComponent(
    file,
    {
      react,
      "lucide-react": new Proxy({}, { get: (_, name) => String(name) }),
      "@radix-ui/react-dialog": dialog,
      "@tanstack/react-router": route,
      "@/components/AppShell": { AppShell: "AppShell", PageHeader: "PageHeader" },
      "@/components/ui-kit": Object.fromEntries(
        ["Card", "Note", "PendingLabel", "SectionTitle"].map((name) => [name, name]),
      ),
      "@/components/BackControl": { BackButton: "BackButton" },
      "@/components/HistoryBackLink": { HistoryBackLink: "HistoryBackLink" },
      ...modules,
    },
    { window: browser, localStorage: { removeItem() {} }, Error, ...globals },
  );
  const component =
    exportName === "Route" ? compiled.Route.options.component : compiled[exportName];
  let tree;
  const render = () => {
    for (let pass = 0; pass < 15; pass++) {
      changed = false;
      cursor = 0;
      effects = [];
      tree = component(props);
      for (const run of effects) run();
      if (!changed) return tree;
    }
    throw new Error("Component did not settle");
  };
  const nodes = () => [...walk(render())];
  return {
    render,
    nodes,
    find: (type) => nodes().filter((node) => node.type === type),
    text: () => textOf(render()),
    button(label) {
      const result = nodes().find(
        (node) => ["button", "BackButton"].includes(node.type) && textOf(node).trim() === label,
      );
      if (!result) throw new Error(`Missing button ${label}: ${textOf(tree)}`);
      return result;
    },
    async flush() {
      render();
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
    async timers() {
      render();
      const tasks = [...timers.values()];
      timers.clear();
      for (const run of tasks) run();
      await this.flush();
    },
    dispose() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

export function* walk(tree) {
  if (Array.isArray(tree)) {
    for (const item of tree) yield* walk(item);
    return;
  }
  if (!tree || typeof tree !== "object") return;
  if (typeof tree.type === "function") {
    yield* walk(tree.type(tree.props));
    return;
  }
  yield tree;
  yield* walk(tree.props?.children);
}
export function textOf(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  if (typeof tree === "object")
    return textOf(typeof tree.type === "function" ? tree.type(tree.props) : tree.props?.children);
  return String(tree);
}
export const event = (value) => ({ preventDefault() {}, target: { value } });
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
