# tooltip

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/tooltip

## Changed

- `components/ui/tooltip.tsx`: rewired from `radix-ui` `TooltipPrimitive` to `@base-ui/react/tooltip` `TooltipPrimitive`. `TooltipContent` restructured using `TooltipPrimitive.Portal > TooltipPrimitive.Positioner > TooltipPrimitive.Popup` with `isolate z-50` and arrow positioning. `TooltipProvider` accepts `delay` (with backwards-compat for `delayDuration`).
- Consumers migrated from `<TooltipTrigger asChild>` to `<TooltipTrigger render={...}>` and `delayDuration` to `delay`:
  - `entrypoints/sidepanel/components/settings/InfoTip.tsx`
  - `entrypoints/sidepanel/components/chat/ContextRing.tsx`
  - `entrypoints/sidepanel/components/chat/MessageItem.tsx`
  - `entrypoints/sidepanel/components/chat/ChatHeader.tsx`
  - `entrypoints/sidepanel/components/chat/ChatInput.tsx`
- Leftover scan: clean (0 matches).

## Left alone

- None.

## Behavior changes

- Tooltip positioner model now positions via Base UI anchor-positioning logic with exact offset and flip behaviors.

## Verify by hand

- Hover over action icons (history, settings, send/stop, copy button, info tips, context ring) to confirm tooltip popups anchor and fade smoothly.
