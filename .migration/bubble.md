# bubble

2026-09-07, golden pair from official shadcn base registry, migrated BubbleContent to @base-ui/react useRender + mergeProps

## Changed

- `components/ui/bubble.tsx`: rewired `BubbleContent` from `radix-ui` `Slot` to `@base-ui/react/use-render` and `@base-ui/react/merge-props`. Changed polymorphism from `asChild` to `render` prop typed via `useRender.ComponentProps<"div">`. Preserved all variants, alignments, and styling. Leftover scan: clean (0 matches).

## Left alone

- All app consumers in `MessageItem.tsx` use standard `<BubbleContent>` props without `asChild`.

## Behavior changes

- None (`asChild` replaced with `render` prop per Base UI standard).

## Verify by hand

- Verify user and assistant bubbles in the chat stream render properly with correct variants and alignment.
