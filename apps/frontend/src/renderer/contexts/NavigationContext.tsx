import { createContext, useContext, type ReactNode } from 'react';
import type { SidebarView } from '../components/Sidebar';

interface NavigationContextValue {
  activeView: SidebarView;
  setActiveView: (view: SidebarView) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

interface NavigationProviderProps {
  children: ReactNode;
  activeView: SidebarView;
  setActiveView: (view: SidebarView) => void;
}

/**
 * NavigationProvider enables programmatic navigation between views
 * from any component in the tree.
 */
export function NavigationProvider({ children, activeView, setActiveView }: NavigationProviderProps) {
  return (
    <NavigationContext.Provider value={{ activeView, setActiveView }}>
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * Hook to access navigation functions from any component.
 *
 * @example
 * ```tsx
 * function TaskCard() {
 *   const { setActiveView } = useNavigation();
 *
 *   const handleViewTerminal = () => {
 *     setActiveView('terminals');
 *   };
 *
 *   return <button onClick={handleViewTerminal}>View Terminal</button>;
 * }
 * ```
 */
export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);

  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }

  return context;
}
