# select

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/select

## Changed

- `components/ui/select.tsx`: rewired from `radix-ui` `SelectPrimitive` to `@base-ui/react/select` `SelectPrimitive`.
  - `Select` is bare re-export: `const Select = SelectPrimitive.Root`.
  - `SelectContent` rewired with `SelectPrimitive.Portal > SelectPrimitive.Positioner > SelectPrimitive.Popup`, with `alignItemWithTrigger` (default true) and `isolate z-50`.
  - `SelectItem` restructured per Base UI: `SelectPrimitive.ItemText` with `shrink-0 whitespace-nowrap`, followed by `SelectPrimitive.ItemIndicator render={<span ...><CheckIcon /></span>}`.
  - `SelectScrollUpButton` / `SelectScrollDownButton` map to `SelectPrimitive.ScrollUpArrow` / `SelectPrimitive.ScrollDownArrow`.
  - `SelectLabel` maps to `SelectPrimitive.GroupLabel`.
- `entrypoints/sidepanel/components/settings/SettingsMainView.tsx`: widened `onValueChange` nullability handling at 3 call sites (`chatModel`, `titleModel`, `quickPromptModel`) per `consumer-props.md`.
- Leftover scan: clean (0 matches).

## Left alone

- None.

## Behavior changes

- Base UI Select positions via Positioner with item-alignment and viewport collision detection natively.

## Verify by hand

- Test all dropdown Selects in Settings (Language, Chat Model, Title Model, Starter Prompt Model, Reasoning Levels, Search Provider, API Provider Protocol) to confirm options list opens, scroll arrows appear when overflowing, and selecting options updates settings cleanly.
