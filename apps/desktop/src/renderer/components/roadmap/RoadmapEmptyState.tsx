import { Map, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import type { RoadmapEmptyStateProps } from './types';

export function RoadmapEmptyState({ onGenerate }: RoadmapEmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-lg p-8 text-center">
        <Map className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Roadmap Yet</h2>
        <p className="text-muted-foreground mb-6">
          Generate an AI-powered roadmap that understands your project's target audience and
          creates a strategic feature plan.
        </p>
        <Button onClick={onGenerate} size="lg">
          <Sparkles className="h-4 w-4 me-2" />
          Generate Roadmap
        </Button>
      </Card>
    </div>
  );
}
