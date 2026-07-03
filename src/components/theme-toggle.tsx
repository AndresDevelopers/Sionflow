"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/contexts/i18n-context";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <div className="flex w-full items-center justify-between" onClick={(e) => e.stopPropagation()}>
      <span>{t("Theme")}</span>
      <Select value={theme} onValueChange={setTheme}>
        <SelectTrigger className="w-[110px] border-0 focus:ring-0">
          <SelectValue placeholder="Theme" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">
            <div className="flex items-center gap-2">
              <Sun className="h-4 w-4" />
              <span>{t("Light")}</span>
            </div>
          </SelectItem>
          <SelectItem value="dark">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4" />
              <span>{t("Dark")}</span>
            </div>
          </SelectItem>
          <SelectItem value="system">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              <span>{t("System")}</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
