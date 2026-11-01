import { test } from "node:test";
import assert from "node:assert/strict";
import { accountUI } from "./account-ui-fixture.mjs";
import * as planner from "../src/lib/planner.ts";
import * as duration from "../src/lib/duration.ts";

function form(type, editing) {
  const writes = [];
  const ui = accountUI(
    "src/components/PlanActivityForm.tsx",
    "PlanActivityForm",
    {
      "@tanstack/react-router": {
        Link: "Link",
        useNavigate: () => async () => {},
        useRouter: () => ({ history: {} }),
      },
      "@tanstack/react-query": { useQueryClient: () => ({}) },
      "@/components/TempoDateTimePicker": {
        TempoDatePicker: "DatePicker",
        TempoTimePicker: "TimePicker",
      },
      "@/components/PlannerParts": {},
      "@/lib/auth": { useAuth: () => ({ user: { id: "me" } }) },
      "@/lib/in-app-back": { backWithinApp: () => false },
      "@/lib/network-errors": { userFacingError: () => "Try again" },
      "@/lib/duration": duration,
      "@/lib/planner": planner,
      "@/lib/planner-query": {
        createPlannedActivity: async (input) => writes.push(input),
        updatePlannedActivity: async (_id, _expected, input) => writes.push(input),
        invalidatePlanner: async () => {},
      },
      "@/lib/training-plans-query": { useActiveTrainingPlan: () => ({ data: null }) },
      "@/lib/workout-templates-query": { useMyWorkouts: () => ({ data: [] }) },
    },
    { profileId: "profile", today: "2026-10-12", initialType: type, editing },
  );
  const input = () =>
    ui
      .find("input")
      .find((node) => node.props["aria-label"] === "Planned duration (minutes:seconds, optional)");
  return {
    ui,
    input,
    writes,
    async submit() {
      ui.find("form")[0].props.onSubmit({ preventDefault() {} });
      await ui.flush();
    },
  };
}
for (const type of ["run", "ride"]) {
  test(`Planner ${type} preserves raw duration on change, canonicalizes on blur and saves exact seconds`, async () => {
    const f = form(type);
    assert.equal(f.input().props.inputMode, "decimal");
    for (const raw of ["15,", "15.", "15:", ",35", ".35"]) {
      f.input().props.onChange({ target: { value: raw } });
      assert.equal(f.input().props.value, raw);
    }
    f.input().props.onChange({ target: { value: "15,35" } });
    f.input().props.onBlur();
    assert.equal(f.input().props.value, "15:35");
    await f.submit();
    assert.equal(f.writes[0].durationSeconds, 935);
  });
  test(`Planner ${type} keeps optional duration and its existing minimum; invalid seconds never write`, async () => {
    const optional = form(type);
    await optional.submit();
    assert.equal(optional.writes[0].durationSeconds, null);
    for (const raw of ["15,60", "0,45"]) {
      const f = form(type);
      f.input().props.onChange({ target: { value: raw } });
      await f.submit();
      assert.equal(f.writes.length, 0);
    }
  });
  test(`editing Planner ${type} preserves stored seconds instead of rounding to whole minutes`, () => {
    const f = form(type, { id: "existing", type, date: "2026-10-12", durationSeconds: 935 });
    assert.equal(f.input().props.value, "15:35");
  });
}
