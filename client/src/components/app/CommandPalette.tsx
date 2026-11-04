import { useEffect, useRef } from "react";
import { Command } from "cmdk";
import { CornerDownLeft, Languages, Search, Sparkles } from "lucide-react";
import { phaseFeatureActive } from "@shared/phase1-features";
import { navigation } from "@/lib/navigation";
import { useI18n } from "@/i18n";

/**
 * Ctrl/Cmd + K quick jump. Searches every screen in both languages, so an
 * Arabic-speaking user can find a page by its English name and vice versa.
 */
export function CommandPalette({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const { t, isAr, toggle } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="cmdk-overlay"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("القفز السريع", "Quick jump")}
      >
        <Command
          loop
          label={t("القفز السريع", "Quick jump")}
          filter={(value, search) =>
            value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <div className="cmdk-input-row">
            <Search size={18} aria-hidden="true" />
            <Command.Input
              ref={inputRef}
              placeholder={t(
                "ابحث عن شاشة أو إجراء…",
                "Search a screen or action…"
              )}
            />
            <kbd>Esc</kbd>
          </div>
          <Command.List>
            <Command.Empty>
              {t("لا توجد نتيجة مطابقة", "No matching result")}
            </Command.Empty>
            {navigation.map(group => (
              <Command.Group
                key={group.titleEn}
                heading={isAr ? group.title : group.titleEn}
              >
                {group.items.map(item => {
                  const active = phaseFeatureActive(item.path);
                  return (
                    <Command.Item
                      key={item.path}
                      value={`${item.label} ${item.english} ${group.title} ${group.titleEn}`}
                      disabled={!active}
                      onSelect={() => {
                        onNavigate(item.path);
                        onClose();
                      }}
                    >
                      <span className="cmdk-icon">
                        <item.icon size={17} />
                      </span>
                      <span className="cmdk-label">
                        {isAr ? item.label : item.english}
                        <small>{isAr ? item.english : item.label}</small>
                      </span>
                      {!active ? (
                        <em className="cmdk-soon">
                          {t("قريبًا", "Coming soon")}
                        </em>
                      ) : (
                        <CornerDownLeft size={14} aria-hidden="true" />
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
            <Command.Group heading={t("إجراءات", "Actions")}>
              <Command.Item
                value="language switch عربي english اللغة language"
                onSelect={() => {
                  toggle();
                  onClose();
                }}
              >
                <span className="cmdk-icon">
                  <Languages size={17} />
                </span>
                <span className="cmdk-label">
                  {t("التبديل إلى English", "Switch to العربية")}
                </span>
              </Command.Item>
              <Command.Item
                value="home landing الصفحة الرئيسية home page"
                onSelect={() => {
                  onNavigate("/");
                  onClose();
                }}
              >
                <span className="cmdk-icon">
                  <Sparkles size={17} />
                </span>
                <span className="cmdk-label">
                  {t("الصفحة الرئيسية", "Home page")}
                </span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
