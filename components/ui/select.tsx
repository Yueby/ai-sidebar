"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

const SelectItemsContext = React.createContext<Map<string, React.ReactNode>>(new Map())

function extractItems(
  children: React.ReactNode,
  map: Map<string, React.ReactNode> = new Map()
): Map<string, React.ReactNode> {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as Record<string, any>
    if (props && props.value !== undefined && props.children !== undefined) {
      map.set(String(props.value), props.children)
    }
    if (props?.children) {
      extractItems(props.children, map)
    }
  })
  return map
}

function Select<Value = any, Multiple extends boolean | undefined = false>({
  children,
  items: itemsProp,
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
  const itemsMap = React.useMemo(() => {
    const map = new Map<string, React.ReactNode>()
    if (itemsProp) {
      if (Array.isArray(itemsProp)) {
        for (const item of itemsProp) {
          if (item && item.value !== undefined) {
            map.set(String(item.value), item.label ?? item.value)
          }
        }
      } else if (typeof itemsProp === "object" && itemsProp !== null) {
        for (const [key, val] of Object.entries(itemsProp)) {
          map.set(key, val as React.ReactNode)
        }
      }
    }
    extractItems(children, map)
    return map
  }, [itemsProp, children])

  const items = React.useMemo(() => {
    if (itemsProp) return itemsProp
    if (itemsMap.size === 0) return undefined
    return Array.from(itemsMap.entries()).map(([value, label]) => ({
      value,
      label,
    }))
  }, [itemsProp, itemsMap])

  return (
    <SelectItemsContext.Provider value={itemsMap}>
      <SelectPrimitive.Root data-slot="select" items={items} {...props}>
        {children}
      </SelectPrimitive.Root>
    </SelectItemsContext.Provider>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("cn-select-group", className)}
      {...props}
    />
  )
}

function SelectValue({
  className,
  placeholder,
  children,
  ...props
}: SelectPrimitive.Value.Props) {
  const itemsMap = React.useContext(SelectItemsContext)

  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("cn-select-value", className)}
      placeholder={placeholder}
      {...props}
    >
      {typeof children === "function"
        ? children
        : (value: any) => {
            if (value == null || value === "" || value === "__none__") {
              return placeholder ?? ""
            }
            const key = String(value)
            if (itemsMap.has(key)) {
              return itemsMap.get(key)
            }
            if (children != null) {
              return children
            }
            return placeholder ?? key
          }}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "cn-select-trigger flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="cn-select-trigger-icon pointer-events-none" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "cn-select-content cn-select-content-logical cn-menu-target cn-menu-translucent relative isolate z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto data-[align-trigger=true]:animate-none",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("cn-select-label", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "cn-select-item relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="cn-select-item-text shrink-0 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="cn-select-item-indicator" />}
      >
        <CheckIcon className="cn-select-item-indicator-icon pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("cn-select-separator pointer-events-none", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn("cn-select-scroll-up-button top-0 w-full", className)}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn("cn-select-scroll-down-button bottom-0 w-full", className)}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
