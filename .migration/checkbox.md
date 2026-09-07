# checkbox

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/checkbox

## Changed

- `components/ui/checkbox.tsx`: rewired from `radix-ui` `CheckboxPrimitive` to `@base-ui/react/checkbox` `CheckboxPrimitive`. Prop type updated to `CheckboxPrimitive.Root.Props`. Updated `disabled:` to `data-disabled:`, and `data-[state=checked]:` to `data-checked:`. Retained `CheckIcon` from `lucide-react` and custom styling. Leftover scan: clean (0 matches).

## Left alone

- Consumers in `ModelConfigDialog.tsx` and `ProviderDialog.tsx` pass standard boolean `checked` and `onCheckedChange` callbacks.

## Behavior changes

- None (neither caller uses indeterminate state).

## Verify by hand

- Open ProviderDialog and ModelConfigDialog, check/uncheck model checkboxes and reasoning level checkboxes to verify toggle and visual indicator display.
