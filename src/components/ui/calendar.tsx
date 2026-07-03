"use client"

import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { es, type Locale } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  locale = es,
  ...props
}: CalendarProps & { locale?: Locale }) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={locale}
      weekStartsOn={1}
      captionLayout="dropdown"
      startMonth={new Date(1900, 0)}
      endMonth={new Date(new Date().getFullYear() + 10, 11)}
      formatters={{
        formatWeekdayName: (date) => {
          const days = ["D", "L", "M", "M", "J", "V", "S"]
          return days[date.getDay()]
        },
      }}
      className={cn("p-4", className)}
      classNames={{
        // Contenedor principal
        months: "relative flex flex-col sm:flex-row gap-x-4",
        month: "space-y-2",
        // Cabecera del mes (donde va el título o los dropdowns)
        month_caption: "flex h-9 items-center justify-center px-8",
        // Navegación prev/next — absoluta sobre la cabecera
        nav: "absolute top-0 inset-x-0 flex justify-between items-center h-9 px-1",
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 rounded-full opacity-60 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 rounded-full opacity-60 hover:opacity-100"
        ),
        // Dropdowns de mes/año
        dropdowns: "flex items-center gap-0.5 justify-center",
        dropdown_root: "relative inline-flex items-center",
        // El <select> real es invisible y se superpone al label visible
        dropdown: "absolute inset-0 opacity-0 cursor-pointer w-full",
        months_dropdown: "",
        years_dropdown: "",
        // El span visible que actúa como botón del dropdown
        caption_label:
          "text-sm font-semibold capitalize inline-flex items-center gap-0.5 px-2 py-1 rounded-md hover:bg-accent transition-colors cursor-pointer select-none",
        // Tabla del calendario
        month_grid: "w-full border-collapse",
        weekdays: "",
        weekday:
          "text-muted-foreground text-[0.75rem] font-medium p-0 text-center align-middle",
        weeks: "",
        week: "",
        // Celda de día — las clases de modificador van aquí (en el <td>)
        day: cn(
          "p-0 text-center focus-within:relative focus-within:z-20",
          // Día seleccionado: fondo primario en el botón
          "[&[data-selected]>button]:bg-primary",
          "[&[data-selected]>button]:text-primary-foreground",
          "[&[data-selected]>button]:hover:bg-primary",
          "[&[data-selected]>button]:hover:text-primary-foreground",
          "[&[data-selected]>button]:shadow-sm",
          // Hoy: anillo sutil (visible incluso al estar seleccionado)
          "[&[data-today]>button]:ring-1",
          "[&[data-today]>button]:ring-primary/40",
          "[&[data-today]>button]:font-semibold",
          // Días fuera del mes
          "[&[data-outside]>button]:opacity-40",
          "[&[data-outside]>button]:text-muted-foreground",
          // Días deshabilitados
          "[&[data-disabled]>button]:opacity-40",
          "[&[data-disabled]>button]:pointer-events-none"
        ),
        // Botón dentro del <td>
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal text-center rounded-full transition-colors"
        ),
        // Clases de estado (se combinan con `day` via getClassNamesForModifiers)
        selected: "",
        today: "",
        outside: "",
        disabled: "",
        hidden: "invisible",
        focused: "",
        range_start: "[&>button]:rounded-full",
        range_end: "[&>button]:rounded-full",
        range_middle:
          "[&>button]:rounded-none [&>button]:bg-accent [&>button]:text-accent-foreground",
        ...classNames,
      }}
      components={{
        Chevron: ({
          className,
          orientation,
        }: {
          className?: string
          orientation?: "up" | "down" | "left" | "right"
        }) => {
          if (orientation === "left") {
            return <ChevronLeft className={cn("h-4 w-4", className)} />
          }
          if (orientation === "right") {
            return <ChevronRight className={cn("h-4 w-4", className)} />
          }
          if (orientation === "up") {
            return <ChevronUp className={cn("h-4 w-4", className)} />
          }
          return <ChevronDown className={cn("h-4 w-4", className)} />
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
