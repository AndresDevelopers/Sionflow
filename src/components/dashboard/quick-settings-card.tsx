
"use client";

import { useTheme } from "next-themes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/contexts/i18n-context";
import { Settings } from "lucide-react";

export function QuickSettingsCard() {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useI18n();

  const handleLangChange = (value: string) => {
    setLanguage(value as "en" | "es");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <span>{t("Quick Settings")}</span>
        </CardTitle>
        <CardDescription>{t("Customize your experience.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="dark-mode" className="flex flex-col space-y-1">
            <span>{t("Dark Mode")}</span>
            <span className="font-normal leading-snug text-muted-foreground text-xs">
              {t("Toggle between light and dark themes.")}
            </span>
          </Label>
          <Switch
            id="dark-mode"
            checked={theme === "dark"}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          />
        </div>
        <div className="flex items-center justify-between">
            <Label htmlFor="language-select">{t("Language")}</Label>
            <Select value={language} onValueChange={handleLangChange}>
                <SelectTrigger id="language-select" className="w-[120px]">
                    <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                </SelectContent>
            </Select>
        </div>
      </CardContent>
    </Card>
  );
}
