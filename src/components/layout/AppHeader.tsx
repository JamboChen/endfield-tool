import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, X, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiGithub, SiDiscord, SiTencentqq } from "react-icons/si";

interface AppHeaderProps {
  onLanguageChange: (lang: string) => void;
}

export default function AppHeader({ onLanguageChange }: AppHeaderProps) {
  const { t, i18n } = useTranslation("app");
  const [showWarning, setShowWarning] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      {/* Header bar with title and controls */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex items-center gap-4">
          {/* Community dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <MessageCircle className="h-4 w-4" />
                <span>{t("header.community")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a
                  href="https://discord.gg/6V7CupPwb6"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <SiDiscord className="h-4 w-4" />
                  <span>{t("header.discord")}</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href="https://qm.qq.com/q/OFNdDzjk4Y"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <SiTencentqq className="h-4 w-4" />
                  <span>{t("header.qqGroup")}</span>
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* GitHub link */}
          <a
            href="https://github.com/JamboChen/endfield-tool"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <SiGithub className="h-4 w-4" />
            <span>GitHub</span>
          </a>

          {/* Language selector */}
          <Select value={i18n.language} onValueChange={onLanguageChange}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh-Hans">简体中文</SelectItem>
              <SelectItem value="zh-Hant">繁體中文</SelectItem>
              <SelectItem value="ja">日本語</SelectItem>
              <SelectItem value="ko">한국어</SelectItem>
              <SelectItem value="es">Español</SelectItem>
              <SelectItem value="ru">Русский</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Development Warning Banner */}
      {showWarning && (
        <Alert
          variant="default"
          className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 relative"
        >
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
          <AlertTitle className="text-yellow-800 dark:text-yellow-400">
            {t("warning.title")}
          </AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-500">
            {t("warning.description")}
          </AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-6 w-6 text-yellow-600 hover:text-yellow-800 dark:text-yellow-500 dark:hover:text-yellow-400"
            onClick={() => setShowWarning(false)}
            aria-label={t("warning.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      )}
    </div>
  );
}
