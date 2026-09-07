# popover

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/popover

## Changed

- `components/ui/popover.tsx`: rewired from `radix-ui` `PopoverPrimitive` to `@base-ui/react/popover` `PopoverPrimitive`. `PopoverContent` restructured with `PopoverPrimitive.Portal > PopoverPrimitive.Positioner > PopoverPrimitive.Popup` with `isolate z-50`. `PopoverAnchor` kept as inert div placeholder.
- `entrypoints/sidepanel/components/chat/ContextPanel.tsx`: updated `<PopoverTrigger asChild>` to `<PopoverTrigger render={<button ... />} />` per `consumer-props.md`.
- Leftover scan: clean (0 matches).

## Left alone

- None.

## Behavior changes

- None. Base UI popover positioning and focus management match Radix Popover.

## Verify by hand

- Click the context ring in the chat header to open the ContextPanel popover, verify positioning above trigger, and click outside to dismiss.
