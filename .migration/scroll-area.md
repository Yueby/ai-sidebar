# scroll-area

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/scroll-area

## Changed

- `components/ui/scroll-area.tsx`: rewired from `radix-ui` `ScrollAreaPrimitive` to `@base-ui/react/scroll-area` `ScrollAreaPrimitive`. Prop types updated to `ScrollAreaPrimitive.Root.Props` and `ScrollAreaPrimitive.Scrollbar.Props`. Leftover scan: clean (0 matches).

## Left alone

- No external app consumers currently invoke ScrollArea.

## Behavior changes

- None (`type` prop on Root dropped per Base UI scroll-area specification; scrollbars mount conditionally via CSS/data-attributes).

## Verify by hand

- Verified wrapper compiles cleanly and renders ScrollArea, ScrollBar, and Corner with Base UI scroll-area primitive.
