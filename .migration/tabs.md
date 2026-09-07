# tabs

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/tabs

## Changed

- `components/ui/tabs.tsx`: rewired from `radix-ui` `TabsPrimitive` to `@base-ui/react/tabs` `TabsPrimitive`. `TabsTrigger` maps to `TabsPrimitive.Tab` and `TabsContent` maps to `TabsPrimitive.Panel`. Replaced `data-[state=active]` with `data-active`, `data-[orientation=horizontal]` with `data-horizontal`, and `group-data-[orientation=horizontal]/tabs:` with `group-data-horizontal/tabs:`. Added `aria-disabled` styling hooks.
- `entrypoints/sidepanel/components/settings/SettingsMainView.tsx`: updated `TabsList` class from `group-data-[orientation=horizontal]/tabs:h-8` to `group-data-horizontal/tabs:h-8`.
- Leftover scan: clean (0 matches).

## Left alone

- None.

## Behavior changes

- Base UI defaults to manual tab activation on click; does not auto-activate on arrow focus (matching official base registry behavior).

## Verify by hand

- Switch tabs in Settings Drawer (Providers, Models, Prompt, Search, Permissions, Backup, About) to confirm active highlight, styling, and view updates.
