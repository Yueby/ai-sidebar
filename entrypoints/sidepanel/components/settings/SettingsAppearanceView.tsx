import React, { useMemo } from 'react';
import { Palette, Monitor, Sun, Moon } from 'lucide-react';
import { i18n } from '#i18n';
import type { AppearanceMode, Settings } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SettingsAppearanceViewProps {
  settings: Settings;
  onUpdateSettings: (settings: Settings) => void;
}

export function SettingsAppearanceView({
  settings,
  onUpdateSettings,
}: SettingsAppearanceViewProps) {
  const currentAppearance: AppearanceMode = settings.appearance || 'system';

  const themeOptions = useMemo(
    () => [
      {
        value: 'system' as const,
        label: i18n.t('appearance.system'),
        desc: i18n.t('appearance.systemDesc'),
        icon: Monitor,
      },
      {
        value: 'light' as const,
        label: i18n.t('appearance.light'),
        desc: i18n.t('appearance.lightDesc'),
        icon: Sun,
      },
      {
        value: 'dark' as const,
        label: i18n.t('appearance.dark'),
        desc: i18n.t('appearance.darkDesc'),
        icon: Moon,
      },
    ],
    []
  );

  const selectedOption =
    themeOptions.find((opt) => opt.value === currentAppearance) ?? themeOptions[0]!;

  return (
    <div className="space-y-3.5 text-left animate-in fade-in-0 duration-150 motion-reduce:animate-none">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Palette className="size-3.5 text-muted-foreground" />
            <span>{i18n.t('appearance.title')}</span>
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">
            {selectedOption.label}
          </span>
        </div>

        <Card className="gap-0 py-0 divide-y divide-border/60 overflow-hidden">
          <div className="flex items-center justify-between gap-2 p-2.5">
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <Label className="text-[11px] font-medium text-foreground">
                {i18n.t('appearance.themeLabel')}
              </Label>
              <span className="text-[10px] text-muted-foreground">
                {selectedOption.desc}
              </span>
            </div>
            <div className="w-36 shrink-0">
              <Select
                items={themeOptions}
                value={currentAppearance}
                onValueChange={(val) => {
                  if (!val) return;
                  onUpdateSettings({
                    ...settings,
                    appearance: val as AppearanceMode,
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {themeOptions.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-1.5">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span>{opt.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
