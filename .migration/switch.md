# switch

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/switch

## Changed

- `components/ui/switch.tsx`: rewired `Switch` from `radix-ui` `SwitchPrimitive` to `@base-ui/react/switch` `SwitchPrimitive`. Prop types updated to `SwitchPrimitive.Root.Props`. Replaced Radix `data-[state=checked]` with `data-checked`, `data-[state=unchecked]` with `data-unchecked`, and `disabled:` with `data-disabled:`. Preserved custom `size` ("sm" | "default") prop and thumb transition styling. Leftover scan: clean (0 matches).

## Left alone

- Callers in `ApprovalSection.tsx`, `RuleDialog.tsx`, and `SettingsPromptView.tsx` pass standard `checked` and `onCheckedChange` boolean callbacks, which are fully supported by Base UI Switch.

## Behavior changes

- None. Base UI `onCheckedChange` passes an additional `eventDetails` argument which does not break existing single-argument handler call sites.

## Verify by hand

- Toggle rule switches in Prompt settings and the grant-session switch on approval cards to confirm thumb slides smoothly and toggle states persist.
