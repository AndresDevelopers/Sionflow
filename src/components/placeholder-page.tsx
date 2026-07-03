import type { LucideIcon } from "lucide-react";

type PlaceholderPageProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function PlaceholderPage({
  title,
  description,
  icon: Icon,
}: PlaceholderPageProps) {
  return (
    <div className="flex h-[calc(100vh-10rem)] w-full items-center justify-center rounded-lg border border-dashed shadow-sm">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icon className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
