# item

2026-09-07, golden pair from official shadcn base registry, migrated Item to @base-ui/react useRender + mergeProps

## Changed

- `components/ui/item.tsx`: rewired `Item` from `radix-ui` `Slot` to `@base-ui/react/use-render` and `@base-ui/react/merge-props`. Switched polymorphism to `render` prop typed via `useRender.ComponentProps<"div">`. Preserved all subcomponents and styling. Leftover scan: clean (0 matches).

## Left alone

- `ApprovalSection.tsx` uses standard `<Item>` container without `asChild`.

## Behavior changes

- None (`asChild` replaced with `render` prop per Base UI standard).

## Verify by hand

- Trigger an action gate card in chat and verify the item card (title, description, icon, actions) renders cleanly.
