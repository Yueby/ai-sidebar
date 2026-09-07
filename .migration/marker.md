# marker

2026-09-07, golden pair from official shadcn base registry, migrated Marker to @base-ui/react useRender + mergeProps

## Changed

- `components/ui/marker.tsx`: rewired `Marker` from `radix-ui` `Slot` to `@base-ui/react/use-render` and `@base-ui/react/merge-props`. Switched polymorphism from `asChild` to `render` prop typed via `useRender.ComponentProps<"div">`. Preserved all variants and child components. Leftover scan: clean (0 matches).

## Left alone

- `CompactionRow.tsx` uses `<Marker variant="separator">` with no `asChild`.

## Behavior changes

- None (`asChild` replaced with `render` prop per Base UI standard).

## Verify by hand

- Trigger context compaction or view an existing compacted conversation to confirm the compaction separator card renders properly with icon and summary text.
