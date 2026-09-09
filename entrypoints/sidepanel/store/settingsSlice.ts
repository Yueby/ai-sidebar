import type { Settings } from '@/lib/types';
import { settingsItem } from '@/lib/storage';
import { DEFAULT_SETTINGS } from '@/lib/providers';
import { setAppearance } from '../theme';

export interface SettingsSlice {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  /** 更新并持久化(init watch 与 UI 处理器共用) */
  updateSettings: (settings: Settings) => Promise<void>;
}

type SliceSet = (partial: Partial<SettingsSlice>) => void;

export function createSettingsSlice(set: SliceSet): SettingsSlice {
  return {
    settings: DEFAULT_SETTINGS,

    setSettings: (settings) => {
      setAppearance(settings.appearance);
      set({ settings });
    },

    updateSettings: async (settings) => {
      setAppearance(settings.appearance);
      set({ settings });
      await settingsItem.setValue(settings);
    },
  };
}
