# alert-dialog

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/alert-dialog

## Changed

- `components/ui/alert-dialog.tsx`: rewired from `radix-ui` `AlertDialogPrimitive` to `@base-ui/react/alert-dialog` `AlertDialogPrimitive`. `AlertDialogOverlay` maps to `AlertDialogPrimitive.Backdrop`, `AlertDialogContent` maps to `AlertDialogPrimitive.Popup`. `AlertDialogAction` wraps `Button` with `data-slot="alert-dialog-action"`. `AlertDialogCancel` wraps `AlertDialogPrimitive.Close` with `render={<Button variant={variant} size={size} />}`.
- `entrypoints/sidepanel/components/UserScriptsGateDialog.tsx`: migrated `<AlertDialogDescription asChild>` to `<AlertDialogDescription render={<div ... />} >` and removed deprecated `onEscapeKeyDown` prop on `AlertDialogContent`.
- Leftover scan: clean (0 matches).

## Left alone

- Callers in `ChatHeader.tsx`, `SettingsBackupView.tsx`, `SettingsMainView.tsx`, and `SettingsPromptView.tsx` pass standard `<AlertDialog open onOpenChange>` props.

## Behavior changes

- Base UI AlertDialog is always modal and does not dismiss on outside press by default. Action button renders Base UI Button directly; Cancel button closes via `AlertDialogPrimitive.Close`.

## Verify by hand

- Trigger session deletion in ChatHeader or provider/rule deletion in settings to verify modal confirmation dialog and cancel/action buttons.
- Verify UserScriptsGateDialog displays uncloseable alert modal on startup when userScripts permission is required.
