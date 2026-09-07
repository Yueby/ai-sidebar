# collapsible

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/collapsible

## Changed

- `components/ui/collapsible.tsx`: rewired from `radix-ui` `CollapsiblePrimitive` to `@base-ui/react/collapsible` `CollapsiblePrimitive`. `CollapsibleContent` maps to `CollapsiblePrimitive.Panel` with `data-slot="collapsible-content"`.
- `entrypoints/sidepanel/components/chat/MessageItem.tsx`: migrated 3 `<CollapsibleTrigger asChild>` call sites to `<CollapsibleTrigger render={<button ... />}>` per `consumer-props.md`.
- `entrypoints/sidepanel/components/chat/ApprovalSection.tsx`: migrated 1 `<CollapsibleTrigger asChild>` call site to `<CollapsibleTrigger render={<button ... />}>`.
- `entrypoints/sidepanel/components/chat/CompactionRow.tsx`: migrated 1 `<CollapsibleTrigger asChild>` call site to `<CollapsibleTrigger render={<button ... />}>`.
- Leftover scan: clean (0 matches).

## Left alone

- None.

## Behavior changes

- None. Base UI collapsible triggers and panel toggle behaviors match Radix.

## Verify by hand

- Click on the references collapsible counter, thinking process disclosure, tool call card headers, approval code detail disclosure, and compaction row disclosure to ensure smooth open/close expansion.
