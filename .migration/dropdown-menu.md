# dropdown-menu

2026-09-07, golden pair from official shadcn base registry, migrated to @base-ui/react/menu

## Changed

- `components/ui/dropdown-menu.tsx`: rewired from `radix-ui` `DropdownMenuPrimitive` to `@base-ui/react/menu` `MenuPrimitive`. `DropdownMenuContent` maps to `MenuPrimitive.Portal > MenuPrimitive.Positioner > MenuPrimitive.Popup`. CSS variables rewired: `--radix-dropdown-menu-content-available-height` -> `--available-height` and `--radix-dropdown-menu-content-transform-origin` -> `--transform-origin`. SubContent composes Content with golden offsets. SubTrigger uses `data-popup-open`.
- `entrypoints/sidepanel/components/chat/ChatHeader.tsx`: updated history dropdown trigger composition to use `render` instead of `asChild`.
- `entrypoints/sidepanel/components/chat/ChatInput.tsx`: migrated 3 `<DropdownMenuTrigger asChild>` call sites to `<DropdownMenuTrigger render={<Button ... />} />`.
- Leftover scan: clean (0 matches).

## Left alone

- None. Callers in ChatHeader and ChatInput already use standard `onClick` callbacks for item actions.

## Behavior changes

- Positioner model positions dropdown menus using Base UI anchor positioning with available height tracking.

## Verify by hand

- Click history button in ChatHeader, plus button in composer, model switcher button, and thinking level selector to confirm dropdown menus open, focus items, and trigger actions.
