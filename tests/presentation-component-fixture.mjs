import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Run the authored presentation primitive, not a copy of its markup or prop handling.
export function presentationComponent(file, modules = {}, globals = {}) {
  const context = {
    crypto: globalThis.crypto,
    ...globals,
    exports: {},
    require(name) {
      if (modules[name]) return modules[name];
      if (name === "./workout-plan-copy" || name === "@/lib/workout-plan-copy")
        return require("../src/lib/workout-plan-copy.ts");
      if (name === "./MealDeleteDialog") return { MealDeleteDialog: "MealDeleteDialog" };
      if (name === "./exercise-records.ts" || name === "@/lib/exercise-records")
        return require("../src/lib/exercise-records.ts");
      if (name === "@/components/ExerciseRecordSummary")
        return presentationComponent(
          "src/components/ExerciseRecordSummary.tsx",
          {
            ...modules,
            "@/lib/calc": modules["@/lib/calc"] ?? require("../src/lib/calc.ts"),
          },
          globals,
        );
      if (name === "@/lib/primary-tab-motion") return require("../src/lib/primary-tab-motion.ts");
      if (name === "./PrimaryTabTransition")
        return presentationComponent(
          "src/components/PrimaryTabTransition.tsx",
          {
            ...modules,
            react: { ...require("react"), ...modules.react },
          },
          globals,
        );
      if (name === "./query-pagination")
        return presentationComponent("src/lib/query-pagination.ts");
      if (name === "@/lib/utils") return presentationComponent("src/lib/utils.ts");
      if (name === "./BackControl" || name === "@/components/BackControl")
        return presentationComponent("src/components/BackControl.tsx", modules, globals);
      if (name === "./MainPageHeader" || name === "@/components/MainPageHeader")
        return presentationComponent(
          "src/components/MainPageHeader.tsx",
          {
            "./NotificationBell": { NotificationBell: "NotificationBell" },
            ...modules,
          },
          globals,
        );
      if (name === "./ChallengeParticipant" || name === "@/components/ChallengeParticipant")
        return presentationComponent("src/components/ChallengeParticipant.tsx", modules, globals);
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
