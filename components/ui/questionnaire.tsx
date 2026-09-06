import * as React from "react"
import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire"
import { type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

function Questionnaire({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      data-slot="questionnaire"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  )
}

function QuestionnaireProgress({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  return (
    <QuestionnairePrimitive.Progress
      data-slot="questionnaire-progress"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function QuestionnaireItem({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      data-slot="questionnaire-item"
      className={cn("flex flex-col gap-2.5 border-0 p-0 m-0 min-w-0", className)}
      {...props}
    />
  )
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      data-slot="questionnaire-title"
      className={cn("text-xs font-medium text-foreground leading-relaxed break-all", className)}
      {...props}
    />
  )
}

function QuestionnaireDescription({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Description>) {
  return (
    <QuestionnairePrimitive.Description
      data-slot="questionnaire-description"
      className={cn("text-[11px] text-muted-foreground leading-normal", className)}
      {...props}
    />
  )
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      data-slot="questionnaire-choices"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function QuestionnaireChoice({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        "group/choice flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border/70 bg-background/80 hover:bg-accent hover:text-accent-foreground text-left text-xs font-normal transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed data-[checked]:border-primary data-[checked]:bg-primary/5 data-[checked]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireChoiceInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.ChoiceInput>) {
  return (
    <QuestionnairePrimitive.ChoiceInput
      data-slot="questionnaire-choice-input"
      className={cn(
        "size-3.5 shrink-0 rounded-full border border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireChoiceLabel({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.ChoiceLabel>) {
  return (
    <QuestionnairePrimitive.ChoiceLabel
      data-slot="questionnaire-choice-label"
      className={cn("flex-1 min-w-0 truncate select-none leading-snug", className)}
      {...props}
    />
  )
}

function QuestionnaireChoiceShortcut({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.ChoiceShortcut>) {
  return (
    <QuestionnairePrimitive.ChoiceShortcut
      data-slot="questionnaire-choice-shortcut"
      className={cn("text-[10px] text-muted-foreground font-mono shrink-0 ml-auto border rounded px-1", className)}
      {...props}
    />
  )
}

function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <QuestionnairePrimitive.Input
      data-slot="questionnaire-input"
      className={cn(
        "flex h-7 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireError({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
  return (
    <QuestionnairePrimitive.Error
      data-slot="questionnaire-error"
      className={cn("text-[11px] text-destructive leading-tight", className)}
      {...props}
    />
  )
}

function QuestionnaireActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-actions"
      className={cn("flex items-center justify-end gap-1.5 pt-1", className)}
      {...props}
    />
  )
}

function QuestionnairePrevious({
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> &
  VariantProps<typeof buttonVariants>) {
  return (
    <QuestionnairePrimitive.Previous
      data-slot="questionnaire-previous"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function QuestionnaireSkip({
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Skip> &
  VariantProps<typeof buttonVariants>) {
  return (
    <QuestionnairePrimitive.Skip
      data-slot="questionnaire-skip"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function QuestionnaireNext({
  className,
  variant = "default",
  size = "sm",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> &
  VariantProps<typeof buttonVariants>) {
  return (
    <QuestionnairePrimitive.Next
      data-slot="questionnaire-next"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function QuestionnaireSubmit({
  className,
  variant = "default",
  size = "sm",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
  VariantProps<typeof buttonVariants>) {
  return (
    <QuestionnairePrimitive.Submit
      data-slot="questionnaire-submit"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export {
  Questionnaire,
  QuestionnaireProgress,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireDescription,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireChoiceInput,
  QuestionnaireChoiceLabel,
  QuestionnaireChoiceShortcut,
  QuestionnaireInput,
  QuestionnaireError,
  QuestionnaireActions,
  QuestionnairePrevious,
  QuestionnaireSkip,
  QuestionnaireNext,
  QuestionnaireSubmit,
}
