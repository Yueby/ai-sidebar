"use client"

import * as React from "react"
import {
  Toast as ToastPrimitive,
  type ToastManagerAddOptions,
  type ToastManagerUpdateOptions,
} from "@base-ui/react/toast"
import { cn } from "cn"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const toastManager = ToastPrimitive.createToastManager()

export interface ToastCustomOptions
  extends Omit<ToastManagerAddOptions<any>, "description" | "type"> {
  action?: {
    label: React.ReactNode
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  }
}

type ToastManagerType = typeof toastManager

export interface ToastHelpers {
  (options: ToastManagerAddOptions<any>): string
  add: ToastManagerType["add"]
  close: ToastManagerType["close"]
  update: ToastManagerType["update"]
  promise: ToastManagerType["promise"]
  error: (description: React.ReactNode, options?: ToastCustomOptions) => string
  warning: (description: React.ReactNode, options?: ToastCustomOptions) => string
  success: (description: React.ReactNode, options?: ToastCustomOptions) => string
  info: (description: React.ReactNode, options?: ToastCustomOptions) => string
  loading: (description: React.ReactNode, options?: ToastCustomOptions) => string
  dismiss: (id?: string) => void
}

function resolveActionProps(options?: ToastCustomOptions) {
  if (!options) return undefined
  if (options.actionProps) return options.actionProps
  if (options.action) {
    return {
      children: options.action.label,
      onClick: options.action.onClick,
    }
  }
  return undefined
}

const toast: ToastHelpers = Object.assign(
  (options: ToastManagerAddOptions<any>) => toastManager.add(options),
  toastManager,
  {
    error: (description: React.ReactNode, options?: ToastCustomOptions) => {
      const { action, actionProps, ...rest } = options ?? {}
      return toastManager.add({
        type: "error",
        description,
        actionProps: resolveActionProps(options),
        ...rest,
      })
    },
    warning: (description: React.ReactNode, options?: ToastCustomOptions) => {
      const { action, actionProps, ...rest } = options ?? {}
      return toastManager.add({
        type: "warning",
        description,
        actionProps: resolveActionProps(options),
        ...rest,
      })
    },
    success: (description: React.ReactNode, options?: ToastCustomOptions) => {
      const { action, actionProps, ...rest } = options ?? {}
      return toastManager.add({
        type: "success",
        description,
        actionProps: resolveActionProps(options),
        ...rest,
      })
    },
    info: (description: React.ReactNode, options?: ToastCustomOptions) => {
      const { action, actionProps, ...rest } = options ?? {}
      return toastManager.add({
        type: "info",
        description,
        actionProps: resolveActionProps(options),
        ...rest,
      })
    },
    loading: (description: React.ReactNode, options?: ToastCustomOptions) => {
      const { action, actionProps, timeout, ...rest } = options ?? {}
      return toastManager.add({
        type: "loading",
        description,
        timeout: timeout ?? 0,
        actionProps: resolveActionProps(options),
        ...rest,
      })
    },
    dismiss: (id?: string) => toastManager.close(id),
  }
)

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />
}

function ToastViewport({
  className,
  position = "top-right",
  ...props
}: ToastPrimitive.Viewport.Props & {
  position?: "bottom-right" | "top-right"
}) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      data-position={position}
      className={cn(
        "group/toast-viewport pointer-events-none fixed z-50 mx-auto w-auto max-w-[calc(100vw-1.25rem)] outline-none sm:mx-0 sm:max-w-sm sm:w-full",
        position === "top-right"
          ? "top-[52px] right-2.5 sm:right-2.5 sm:left-auto"
          : "inset-x-4 bottom-4 sm:right-4 sm:left-auto",
        className
      )}
      {...props}
    />
  )
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "cn-toast group/toast pointer-events-auto absolute right-0 z-[calc(1000-var(--toast-index))] w-full border bg-popover text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "bottom-0 origin-bottom",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "group-data-[position=top-right]/toast-viewport:top-0 group-data-[position=top-right]/toast-viewport:bottom-auto group-data-[position=top-right]/toast-viewport:origin-top",
        "group-data-[position=top-right]/toast-viewport:[--offset-y:calc(var(--toast-offset-y)*1+calc(var(--toast-index)*var(--gap)*1)+var(--toast-swipe-movement-y))]",
        "group-data-[position=top-right]/toast-viewport:[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--peek))+(var(--shrink)*var(--height))))_scale(var(--scale))]",
        "group-data-[position=top-right]/toast-viewport:after:top-auto group-data-[position=top-right]/toast-viewport:after:bottom-full",
        "group-data-[position=top-right]/toast-viewport:data-starting-style:[transform:translateY(-150%)]",
        "group-data-[position=top-right]/toast-viewport:[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(-150%)]",
        "group-data-[position=top-right]/toast-viewport:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "group-data-[position=top-right]/toast-viewport:data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        className
      )}
      {...props}
    />
  )
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-center gap-3 overflow-hidden p-3.5 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-xs leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn("shrink-0", className)}
      {...props}
    />
  )
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className
      )}
      {...props}
    >
      {children ?? <XIcon className="size-4" aria-hidden="true" />}
    </ToastPrimitive.Close>
  )
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null

  if (type === "success") {
    icon = <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
  }

  if (type === "info") {
    icon = <InfoIcon className="size-4 text-muted-foreground" aria-hidden="true" />
  }

  if (type === "warning") {
    icon = <TriangleAlertIcon className="size-4 text-warning" aria-hidden="true" />
  }

  if (type === "error") {
    icon = <OctagonXIcon className="size-4 text-destructive" aria-hidden="true" />
  }

  if (type === "loading") {
    icon = <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
  }

  if (!icon) {
    return null
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose />
      </ToastContent>
    </Toast>
  ))
}

function Toaster({
  children,
  toastManager: toastManagerProp,
  position = "top-right",
  ...props
}: ToastPrimitive.Provider.Props & {
  position?: "bottom-right" | "top-right"
}) {
  return (
    <ToastProvider toastManager={toastManagerProp ?? toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport position={position}>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}

const createToastManager = ToastPrimitive.createToastManager
const useToastManager = ToastPrimitive.useToastManager

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
}
