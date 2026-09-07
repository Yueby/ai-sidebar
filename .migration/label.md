# label

2026-09-07, transformation engine per Base UI specification, rewired to native label element

## Changed

- `components/ui/label.tsx`: rewired from `radix-ui` `LabelPrimitive.Root` to native `<label>` element. Prop type updated to `React.ComponentProps<"label">`. Classes preserved. Leftover scan: clean (0 matches).

## Left alone

- Consumers in settings and chat dialogs/views untouched as native `<label>` accepts standard HTML attributes (`htmlFor`, `className`, etc.).

## Behavior changes

- None (native `<label>` semantics match Radix Label).

## Verify by hand

- Click on input labels in Settings dialogs (e.g. ProviderDialog, RuleDialog) to confirm input focus triggers properly.
