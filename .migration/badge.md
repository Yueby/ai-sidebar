# badge

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react useRender + mergeProps

## Changed

- `components/ui/badge.tsx`: rewired from `radix-ui` `Slot` to `@base-ui/react/use-render` and `@base-ui/react/merge-props`. Switched polymorphism from `asChild` to `render` prop typed via `useRender.ComponentProps<"span">`. Preserved all variant classes. Leftover scan: clean (0 matches).

## Left alone

- All consumers use standard `<Badge>` element attributes.

## Behavior changes

- None (`asChild` replaced with `render` prop per Base UI standard).

## Verify by hand

- Verify badge rendering across sidepanel (e.g. active badge, token counts, status badges).
