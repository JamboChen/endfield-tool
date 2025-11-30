import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AppHeaderProps {
  onLanguageChange: (lang: string) => void;
}

export default function AppHeader({ onLanguageChange }: AppHeaderProps) {
  const { t, i18n } = useTranslation("app");

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <div className="flex items-center gap-4">
        {/* Language selector */}
        <Select value={i18n.language} onValueChange={onLanguageChange}>
          <SelectTrigger className="w-[120px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="zh-Hans">简体中文</SelectItem>
            <SelectItem value="zh-Hant">繁體中文</SelectItem>
          </SelectContent>
        </Select>
        <a
          href="https://github.com/JamboChen/endfield-tool"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <img
            height="16"
            width="16"
            src="https://cdn.simpleicons.org/github/181717"
            alt="GitHub"
          />
          <span>GitHub</span>
        </a>
      </div>
    </div>
  );
}
