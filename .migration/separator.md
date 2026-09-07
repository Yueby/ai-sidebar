# separator

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/separator

## Changed

- `components/ui/separator.tsx`: rewired from `radix-ui` `SeparatorPrimitive.Root` to `@base-ui/react/separator` `SeparatorPrimitive`. Prop type updated from `React.ComponentProps<typeof SeparatorPrimitive.Root>` to `SeparatorPrimitive.Props`. Removed `decorative` prop (no Base UI counterpart). Updated orientation classes to `data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch`. Leftover scan: clean (0 matches).

## Left alone

- Consumers `entrypoints/sidepanel/components/chat/ContextPanel.tsx` and `entrypoints/sidepanel/components/settings/ProviderDialog.tsx` already use standard `className` without `decorative`.

## Behavior changes

- `decorative` prop dropped per Base UI specification (Base UI separator renders accessible separator div without `decorative` toggle).

## Verify by hand

- Open ContextPanel and Settings ProviderDialog; confirm horizontal dividers render identically.
