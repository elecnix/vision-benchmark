import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface ModelVisibilityContextValue {
  visibleModels: Set<string>;
  toggleModel: (m: string) => void;
  toggleAll: (show: boolean) => void;
  allVisible: boolean;
  noneVisible: boolean;
}

export const ModelVisibilityContext = createContext<ModelVisibilityContextValue>({
  visibleModels: new Set(),
  toggleModel: () => {},
  toggleAll: () => {},
  allVisible: false,
  noneVisible: true,
});

export function ModelVisibilityProvider({ top3, mods, children }: { top3: string[]; mods: string[]; children: ReactNode }) {
  const [visibleModels, setVisibleModels] = useState<Set<string>>(() => new Set(top3));

  const toggleModel = useCallback((m: string) => {
    setVisibleModels(prev => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }, []);

  const toggleAll = useCallback((show: boolean) => {
    setVisibleModels(show ? new Set(mods) : new Set());
  }, [mods]);

  const allVisible = mods.every(m => visibleModels.has(m));
  const noneVisible = mods.every(m => !visibleModels.has(m));

  return (
    <ModelVisibilityContext.Provider value={{ visibleModels, toggleModel, toggleAll, allVisible, noneVisible }}>
      {children}
    </ModelVisibilityContext.Provider>
  );
}

export function useModelVisibility() {
  return useContext(ModelVisibilityContext);
}
