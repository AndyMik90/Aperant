import { Zap, Palette, BookOpen, Shield, Gauge } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

interface IdeationFiltersProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

export function IdeationFilters({ activeTab, onTabChange, children }: IdeationFiltersProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full flex flex-col">
      <TabsList className="shrink-0 mx-4 mt-4 flex-wrap h-auto gap-1">
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="code_improvements">
          <Zap className="h-3 w-3 me-1" />
          Code
        </TabsTrigger>
        <TabsTrigger value="ui_ux_improvements">
          <Palette className="h-3 w-3 me-1" />
          UI/UX
        </TabsTrigger>
        <TabsTrigger value="documentation_gaps">
          <BookOpen className="h-3 w-3 me-1" />
          Docs
        </TabsTrigger>
        <TabsTrigger value="security_hardening">
          <Shield className="h-3 w-3 me-1" />
          Security
        </TabsTrigger>
        <TabsTrigger value="performance_optimizations">
          <Gauge className="h-3 w-3 me-1" />
          Performance
        </TabsTrigger>
      </TabsList>
      {children}
    </Tabs>
  );
}
