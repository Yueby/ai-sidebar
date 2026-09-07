# dialog

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/dialog

## Changed

- `components/ui/dialog.tsx`: rewired from `radix-ui` `DialogPrimitive` to `@base-ui/react/dialog` `DialogPrimitive`. `DialogOverlay` maps to `DialogPrimitive.Backdrop`, `DialogContent` maps to `DialogPrimitive.Popup`. Replaced `data-[state=open]` with `data-open` and `data-[state=closed]` with `data-closed`. `DialogFooter` close button uses `render={<Button variant="outline" />}`. Leftover scan: clean (0 matches).

## Left alone

- Callers in `ModelConfigDialog.tsx`, `ProviderDialog.tsx`, and `RuleDialog.tsx` use standard `<Dialog open onOpenChange>` and subparts.

## Behavior changes

- None. Base UI centered modal dialog behavior, backdrop click dismissal, Escape key handling, and focus trapping match Radix Dialog.

## Verify by hand

- Open ProviderDialog, ModelConfigDialog, and RuleDialog in settings; verify modal backdrop displays, focus is trapped, close button (X) and Escape key dismiss the dialog.
