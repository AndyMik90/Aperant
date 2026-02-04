import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map, Lightbulb } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Roadmap } from './Roadmap';
import { Ideation } from './Ideation';

interface DiscoveryHubProps {
  projectId: string;
  onGoToTask?: (taskId: string) => void;
}

export function DiscoveryHub({ projectId, onGoToTask }: DiscoveryHubProps) {
  const { t } = useTranslation(['navigation']);
  const [activeTab, setActiveTab] = useState<'roadmap' | 'ideas'>('roadmap');

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'roadmap' | 'ideas')}
        className="flex h-full flex-col"
      >
        {/* Tab navigation header */}
        <div className="border-b border-border px-6 pt-4">
          <TabsList className="h-10">
            <TabsTrigger value="roadmap" className="gap-2">
              <Map className="h-4 w-4" />
              {t('items.roadmap')}
            </TabsTrigger>
            <TabsTrigger value="ideas" className="gap-2">
              <Lightbulb className="h-4 w-4" />
              {t('items.ideation')}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab content - fills remaining space */}
        <TabsContent value="roadmap" className="flex-1 m-0 overflow-hidden">
          <Roadmap projectId={projectId} onGoToTask={onGoToTask} />
        </TabsContent>

        <TabsContent value="ideas" className="flex-1 m-0 overflow-hidden">
          <Ideation projectId={projectId} onGoToTask={onGoToTask} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
