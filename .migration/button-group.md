# button-group

2026-09-07, golden pair from official shadcn base registry, migrated ButtonGroupText to @base-ui/react useRender + mergeProps

## Changed

- `components/ui/button-group.tsx`: rewired `ButtonGroupText` from `radix-ui` `Slot` to `@base-ui/react/use-render` and `@base-ui/react/merge-props`. Polymorphic `asChild` replaced with `render` prop typed as `useRender.ComponentProps<"div">`. `ButtonGroupSeparator` orientation classes updated to `data-horizontal` / `data-vertical`. Leftover scan: clean (0 matches).

## Left alone

- `ApprovalSection.tsx` uses `<ButtonGroup>` container directly with no child polymorphism.

## Behavior changes

- None (`asChild` replaced with `render` prop per Base UI standard).

## Verify by hand

- Trigger an action gate / approval card in chat to confirm the button group displays Allow / Deny buttons properly styled together.
