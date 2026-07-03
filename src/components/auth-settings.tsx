
"use client";

import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Separator } from "@/components/ui/separator";

export function AuthSettings() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-3">
        <div className="space-y-2">
            <h4 className="font-medium leading-none">Ajustes</h4>
            <p className="text-sm text-muted-foreground">
                Personaliza tu experiencia.
            </p>
        </div>
        <Separator />
        <LanguageSwitcher />
        <ThemeToggle />
      </PopoverContent>
    </Popover>
  );
}
