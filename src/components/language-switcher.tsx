"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/contexts/i18n-context";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  const handleValueChange = (value: string) => {
    setLanguage(value as 'en' | 'es');
  }

  return (
    <div className="flex w-full items-center justify-between" onClick={(e) => e.stopPropagation()}>
      <span>{t("Language")}</span>
      <Select value={language} onValueChange={handleValueChange}>
        <SelectTrigger className="w-[110px] border-0 focus:ring-0">
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="es">Español</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
