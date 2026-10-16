"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { useI18n } from "../I18nProvider";
import { SidebarIcon } from "./SidebarIcon";
import type { ProjectSortMode } from "./projects";

function isKeyboardActivation(event: { type: string; detail?: number }): boolean {
  return event.type.startsWith("key") || (event.type === "click" && event.detail === 0);
}

export function ProjectSortMenu({ value, onChange }: {
  value: ProjectSortMode;
  onChange: (mode: ProjectSortMode, animate: boolean) => void;
}) {
  const { t } = useI18n();
  const [instant, setInstant] = useState(false);
  return <Menu.Root modal={false} onOpenChange={(_open, details) => {
    if (isKeyboardActivation(details.event)) setInstant(true);
  }}>
    <Menu.Trigger className="sidebar-icon-button sidebar-sort-trigger" aria-label={t("sidebar.sortProjects")} title={t("sidebar.sortProjects")} data-custom={value !== "name" || undefined} onPointerDown={() => setInstant(false)} onKeyDown={() => setInstant(true)}>
      <SidebarIcon name="sort" size={16} />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner sideOffset={6} align="end" className="sidebar-sort-positioner">
        <Menu.Popup className="sidebar-sort-menu material-popover shadow-popover" data-instant={instant || undefined}>
          <Menu.Group>
            <Menu.GroupLabel className="sidebar-sort-label">{t("sidebar.sortProjects")}</Menu.GroupLabel>
            <Menu.RadioGroup value={value} onValueChange={(mode, details) => {
              if (mode === "name" || mode === "recent" || mode === "manual") {
                onChange(mode, !isKeyboardActivation(details.event));
              }
            }} aria-label={t("sidebar.sortProjects")}>
              {(["name", "recent", "manual"] as const).map((mode) => <Menu.RadioItem className="sidebar-sort-option" value={mode} key={mode}>
                <span className="sidebar-sort-check"><Menu.RadioItemIndicator><SidebarIcon name="check" size={13} /></Menu.RadioItemIndicator></span>
                <span>{t(mode === "name" ? "sidebar.sortName" : mode === "recent" ? "sidebar.sortRecent" : "sidebar.sortManual")}</span>
              </Menu.RadioItem>)}
            </Menu.RadioGroup>
          </Menu.Group>
          <div className="sidebar-sort-hint">{t("sidebar.sortHint")}</div>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
