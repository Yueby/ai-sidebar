# project migration: Radix UI -> Base UI

2026-09-07, whole-project mode migration to @base-ui/react

## Summary

- Migrated all 19 Radix UI components in `components/ui/` to `@base-ui/react`:
  - `separator`: rewired to `@base-ui/react/separator` (data-horizontal / data-vertical)
  - `label`: rewired to native `<label>` per Base UI specification
  - `button`: rewired to `@base-ui/react/button` `ButtonPrimitive` (render prop)
  - `badge`: rewired to `@base-ui/react/use-render` + `mergeProps`
  - `bubble`: rewired `BubbleContent` to `@base-ui/react/use-render` + `mergeProps`
  - `button-group`: rewired `ButtonGroupText` to `@base-ui/react/use-render` + `mergeProps`
  - `item`: rewired `Item` to `@base-ui/react/use-render` + `mergeProps`
  - `marker`: rewired `Marker` to `@base-ui/react/use-render` + `mergeProps`
  - `switch`: rewired to `@base-ui/react/switch` (data-checked / data-unchecked / data-disabled)
  - `checkbox`: rewired to `@base-ui/react/checkbox` (data-checked / data-disabled)
  - `scroll-area`: rewired to `@base-ui/react/scroll-area`
  - `collapsible`: rewired to `@base-ui/react/collapsible`
  - `tabs`: rewired to `@base-ui/react/tabs` (Tab, Panel, data-active, group-data-horizontal)
  - `tooltip`: rewired to `@base-ui/react/tooltip` (Portal > Positioner > Popup)
  - `popover`: rewired to `@base-ui/react/popover` (Portal > Positioner > Popup)
  - `dialog`: rewired to `@base-ui/react/dialog` (Backdrop, Popup)
  - `alert-dialog`: rewired to `@base-ui/react/alert-dialog` (Backdrop, Popup, Button for Action, Close for Cancel)
  - `dropdown-menu`: rewired to `@base-ui/react/menu` (MenuPrimitive, Positioner > Popup)
  - `select`: rewired to `@base-ui/react/select` (Positioner > Popup > List, ItemText, ItemIndicator)

## Consumer app code sweeps

- `asChild` -> `render` across `MessageItem.tsx`, `ApprovalSection.tsx`, `CompactionRow.tsx`, `ContextRing.tsx`, `ChatHeader.tsx`, `ChatInput.tsx`, `InfoTip.tsx`, `UserScriptsGateDialog.tsx`.
- `delayDuration` -> `delay` on `TooltipProvider` call sites.
- `Select` `onValueChange` nullability handling widened in `SettingsMainView.tsx`.
- `TabsList` orientation classes updated to `group-data-horizontal/tabs:h-8`.

## Dependencies

- Added: `@base-ui/react` (v1.8.0)
- Removed: `radix-ui` (completely uninstalled)

## Remaining on Radix

- 0 wrappers remain on Radix.
- Non-radix wrappers left intentionally untouched: `drawer.tsx` (vaul), `sonner.tsx` (sonner), `card.tsx`, `empty.tsx`, `input.tsx`, `message-scroller.tsx` (@shadcn/react), `message.tsx`, `questionnaire.tsx` (@shadcn/react), `skeleton.tsx`, `spinner.tsx`, `textarea.tsx`.

## Final build result

- `pnpm compile`: passed (0 TypeScript errors)
- `pnpm build`: passed (clean production extension build)
