# button

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/button

## Changed

- `components/ui/button.tsx`: rewired from `radix-ui` `Slot` to `@base-ui/react/button` `ButtonPrimitive`. Removed `asChild` prop handling (Base UI `ButtonPrimitive` supports polymorphic rendering via `render` prop natively). Preserved all custom variants and sizes (`default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`). Leftover scan: clean (0 matches).

## Left alone

- All app consumers already use standard `<Button>` props without `asChild`.

## Behavior changes

- None (polymorphism switched from `asChild` to `render` prop per Base UI standard).

## Verify by hand

- Click buttons across the app (header icons, settings action buttons, dialog submit buttons) to confirm click handlers, focus rings, and disabled states function properly.
