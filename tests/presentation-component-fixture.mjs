import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Run the authored presentation primitive, not a copy of its markup or prop handling.
export function presentationComponent(file, modules = {}, globals = {}) {
  const context = {
    ...globals,
    exports: {},
    require(name) {
      if (modules[name]) return modules[name];
      if (name === "@/lib/utils") return presentationComponent("src/lib/utils.ts");
      return require(name);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  return context.exports;
}
